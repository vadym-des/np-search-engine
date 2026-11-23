#!/usr/bin/env python3
"""
Локальний багатопотоковий сервер з gzip-стисненням та проксі для API Нової пошти
(вирішення проблеми CORS у браузері та миттєва віддача великих JS-баз).
"""

import gzip
import http.server
import json
import os
import socketserver
import threading
import urllib.error
import urllib.parse
import urllib.request

PORT = int(os.environ.get('PORT', 8081))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

GZIP_EXTENSIONS = {'.js', '.css', '.html', '.json', '.svg', '.txt', '.md'}
_gzip_cache = {}
_gzip_cache_lock = threading.Lock()


def load_env():
    env_file = os.path.join(DIRECTORY, '.env')
    if os.path.exists(env_file):
        try:
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except Exception as e:
            print(f"Помилка завантаження .env: {e}")


load_env()


def get_server_api_key():
    return os.environ.get('NOVA_POSHTA_API_KEY') or os.environ.get('NP_API_KEY') or ''


def get_gzipped_file_bytes(fs_path, st):
    key = fs_path
    sig = (st.st_mtime_ns, st.st_size)
    with _gzip_cache_lock:
        cached = _gzip_cache.get(key)
        if cached and cached[0] == sig:
            return cached[1]

    with open(fs_path, 'rb') as f:
        raw = f.read()
    compressed = gzip.compress(raw, compresslevel=6)

    with _gzip_cache_lock:
        if len(_gzip_cache) > 64:
            _gzip_cache.clear()
        _gzip_cache[key] = (sig, compressed)
    return compressed


class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class PostalProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path == '/api/status':
            server_key = get_server_api_key()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            resp = json.dumps({'success': True, 'hasServerKey': bool(server_key)}).encode('utf-8')
            self.wfile.write(resp)
            return

        # Віддача статичних текстових/JS/CSS файлів із прозорим gzip-стисненням та кешем у RAM
        accept_enc = self.headers.get('Accept-Encoding', '')
        if 'gzip' in accept_enc and not self.headers.get('Range'):
            fs_path = self.translate_path(self.path)
            if os.path.isdir(fs_path):
                index_candidate = os.path.join(fs_path, 'index.html')
                if os.path.isfile(index_candidate):
                    fs_path = index_candidate
            _, ext = os.path.splitext(fs_path)
            if ext.lower() in GZIP_EXTENSIONS and os.path.isfile(fs_path):
                try:
                    st = os.stat(fs_path)
                    if st.st_size >= 1024:
                        gz_bytes = get_gzipped_file_bytes(fs_path, st)
                        ctype = self.guess_type(fs_path)
                        if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
                            if 'charset=' not in ctype:
                                ctype = f'{ctype}; charset=utf-8'
                        self.send_response(200)
                        self.send_header('Content-Type', ctype)
                        self.send_header('Content-Encoding', 'gzip')
                        self.send_header('Vary', 'Accept-Encoding')
                        self.send_header('Content-Length', str(len(gz_bytes)))
                        self.send_header('Cache-Control', 'no-cache')
                        self.send_header('Last-Modified', self.date_time_string(st.st_mtime))
                        self.end_headers()
                        self.wfile.write(gz_bytes)
                        return
                except (BrokenPipeError, ConnectionResetError):
                    return
                except Exception:
                    pass

        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        # Проксі для запитів до Нової пошти
        if self.path == '/api/novaposhta':
            content_length = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_length)

            try:
                # Якщо клієнт не передав ключ, але ключ налаштовано на сервері в .env
                server_key = get_server_api_key()
                if server_key:
                    try:
                        data = json.loads(post_body.decode('utf-8'))
                        if not data.get('apiKey'):
                            data['apiKey'] = server_key
                            post_body = json.dumps(data).encode('utf-8')
                    except Exception:
                        pass

                # Робимо запит до сервера Нової пошти безпосередньо з бекенду (без обмежень браузерного CORS)
                req = urllib.request.Request(
                    'https://api.novaposhta.ua/v2.0/json/',
                    data=post_body,
                    headers={'Content-Type': 'application/json'}
                )
                with urllib.request.urlopen(req, timeout=10) as response:
                    res_body = response.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(res_body)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                err_data = json.dumps({'success': False, 'errors': [str(e)]}).encode('utf-8')
                self.wfile.write(err_data)
        else:
            self.send_error(404, 'Endpoint Not Found')

    def do_OPTIONS(self):
        # Підтримка CORS Preflight
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


if __name__ == '__main__':
    with ThreadingHTTPServer(("", PORT), PostalProxyHandler) as httpd:
        has_key = "встановлено (приховано)" if get_server_api_key() else "не встановлено (використовується локальна база)"
        print(f"Поштовий сервер (Threading + Gzip) запущено на http://localhost:{PORT}")
        print(f"Статус API ключа: {has_key}")
        httpd.serve_forever()
