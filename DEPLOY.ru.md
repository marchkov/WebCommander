# Инструкция по деплою WebCommander на сервер

## Аутентификация и сессии в production

Передайте серверному процессу переменные, заменив все примеры своими значениями:

```text
NODE_ENV=production
WC_AUTH_ENABLED=true
WC_AUTH_USERS=[{"username":"admin","password":"<strong-password>"}]
WC_SESSION_SECRET=<at-least-32-random-characters>
WC_COOKIE_SECURE=true
WC_TRUST_PROXY=1
WC_ALLOW_MEMORY_SESSION_STORE=true
WC_SESSION_COOKIE_NAME=webcommander.sid
WC_SESSION_MAX_AGE=86400000
WC_CORS_ORIGINS=
```

Production не запускается с отсутствующим, шаблонным или коротким секретом сессии (минимум 32 символа), пустыми учётными данными, `admin/***REMOVED***`, повреждённым JSON пользователей или MemoryStore без явного разрешения. Секрет не генерируется автоматически. В development/test прежние значения по умолчанию допускаются с предупреждениями без раскрытия значений.

`WC_ALLOW_MEMORY_SESSION_STORE=true` допустимо только как осознанный выбор для одного процесса/экземпляра, если потеря сессий после перезапуска приемлема. Сессии хранятся только в памяти; несколько экземпляров и большие production-нагрузки этим хранилищем не поддерживаются. Внешнее хранилище пока не добавляется. Пароли в конфигурации остаются открытым текстом; сравнение хешей за постоянное время не заменяет хранение хешированных паролей. Миграция хранения паролей — отдельный этап.

Используйте HTTPS. `WC_COOKIE_SECURE` по умолчанию true в production и false в остальных режимах; явное значение env/config имеет приоритет. Cookie всегда HttpOnly и SameSite=Lax. `WC_TRUST_PROXY=1` задавайте только для одного доверенного reverse proxy, без обходного недоверенного доступа к backend. По умолчанию proxy не доверяются; поддерживаются boolean и неотрицательное количество переходов. Без HTTPS или доверенного HTTPS-прокси Secure-cookie не выдаётся. См. [документацию Express Session](https://expressjs.com/en/resources/middleware/session/).

Env перекрывает соответствующие настройки config. Пользователи берутся из `WC_AUTH_USERS`, затем `config.auth.users`, затем из явно заданных `WC_AUTH_USERNAME`/`WC_AUTH_PASSWORD`. В production не создаётся неявный пользователь. Для замены пользователей из config задайте `WC_AUTH_USERS`. Дополнительные поля config расположены в `auth`: `cookieSecure`, `trustProxy`, `cookieName`, `allowMemorySessionStore`, `corsOrigins`.

Пустой `WC_CORS_ORIGINS` означает размещение на одном origin. Для разрешённого доступа используйте точные origin через запятую, например `https://files.example.com,https://dashboard.example.com`. Wildcard отклоняется; неизвестные origin не получают credentialed CORS headers. SameSite=Lax сохраняется, поэтому сторонние cookie этим не разрешаются автоматически. HTTP и терминальный WebSocket используют один session middleware; WebSocket сохраняет проверку того же host.

Docker-образ не содержит `config.json`, паролей и секретов по умолчанию. Передавайте env или явно подключите собственный config только для чтения. `.env.example` требует настройки перед production-запуском. Node напрямую не читает `.env`: экспортируйте переменные или передайте их через systemd/менеджер процессов. При входе меняется ID сессии; logout закрывает её SSH-соединения, уничтожает сессию и удаляет cookie.

## 🚀 Быстрый старт

### 1. Загрузка на сервер

```bash
# Скопируйте файлы на сервер через SCP, FTP или Git
scp -r WebCommander user@server:/opt/

# Или через Git
git clone <repository-url> /opt/WebCommander
```

### 2. Установка зависимостей

```bash
cd /opt/WebCommander
npm install
```

### 3. Настройка конфигурации

Отредактируйте `config.json`:

```bash
nano config.json
```

**Важные настройки:**
- Измените `rootPath` на нужную директорию Linux, например `/srv/webcommander/files`
- Укажите в `allowedPaths` только нужные директории
- Измените пароли пользователей и `sessionSecret` на случайные значения
- Убедитесь, что `blockedPaths` исключает системные каталоги

### 4. Сборка фронтенда

```bash
npm run build
```

### 5. Запуск сервера

```bash
# Простой запуск
node server/index.js

# Или используйте скрипт
chmod +x start.sh
./start.sh
```

### 6. Запуск в фоне (рекомендуется)

#### Вариант 1: PM2 (рекомендуется)

```bash
# Установите PM2
npm install -g pm2

# Запустите приложение
pm2 start server/index.js --name webcommander

# Сохраните конфигурацию
pm2 save

# Настройте автозапуск
pm2 startup
```

**Полезные команды PM2:**
```bash
pm2 status              # Статус
pm2 logs webcommander  # Логи
pm2 restart webcommander  # Перезапуск
pm2 stop webcommander     # Остановка
```

#### Вариант 2: Systemd

Создайте файл `/etc/systemd/system/webcommander.service`:

```ini
[Unit]
Description=WebCommander File Manager
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/WebCommander
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Запустите:
```bash
sudo systemctl daemon-reload
sudo systemctl enable webcommander
sudo systemctl start webcommander
sudo systemctl status webcommander
```

## 🔐 Настройка Nginx reverse proxy

### 1. Установите Nginx

```bash
sudo apt update
sudo apt install nginx
```

### 2. Создайте конфигурацию

```bash
sudo nano /etc/nginx/sites-available/webcommander
```

```nginx
server {
    listen 80;
    server_name files.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name files.yourdomain.com;

    # SSL certificates (используйте Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/files.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/files.yourdomain.com/privkey.pem;
    
    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Logs
    access_log /var/log/nginx/webcommander.access.log;
    error_log /var/log/nginx/webcommander.error.log;

    # Proxy settings
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Upload size
        client_max_body_size 100M;
    }
}
```

### 3. Активируйте сайт

```bash
sudo ln -s /etc/nginx/sites-available/webcommander /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Получите SSL сертификат (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d files.yourdomain.com
```

## 🔒 Дополнительные меры безопасности

### 1. Firewall (UFW)

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 2. Ограничение доступа по IP

В Nginx конфигурации:

```nginx
location / {
    # Разрешить только определенные IP
    allow 192.168.1.0/24;
    allow 10.0.0.0/8;
    deny all;
    
    proxy_pass http://localhost:3001;
    # ... остальные настройки
}
```

### 3. Базовая HTTP аутентификация (дополнительный слой)

```bash
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd admin
```

В Nginx:

```nginx
location / {
    auth_basic "Restricted Access";
    auth_basic_user_file /etc/nginx/.htpasswd;
    
    proxy_pass http://localhost:3001;
    # ...
}
```

## 📊 Мониторинг и логи

### Просмотр логов

```bash
# PM2
pm2 logs webcommander

# Systemd
sudo journalctl -u webcommander -f

# Nginx
sudo tail -f /var/log/nginx/webcommander.access.log
sudo tail -f /var/log/nginx/webcommander.error.log
```

### Ротация логов

Создайте `/etc/logrotate.d/webcommander`:

```
/var/log/nginx/webcommander.*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
```

## 🔄 Обновление

```bash
cd /opt/webcommander

# Остановите сервис
sudo systemctl stop webcommander
# или: pm2 stop webcommander

# Обновите код
git pull

# Установите новые зависимости
npm install

# Пересоберите фронтенд
npm run build

# Запустите сервис
sudo systemctl start webcommander
# или: pm2 restart webcommander
```

## 🐛 Решение проблем

### Сервер не запускается

```bash
# Проверьте логи
pm2 logs webcommander
# или
sudo journalctl -u webcommander -n 50

# Проверьте порт
sudo netstat -tulpn | grep 3001
```

### Нет доступа к файлам

- Проверьте права доступа: `ls -la /path/to/files`
- Убедитесь, что пользователь сервера имеет доступ: `sudo -u www-data ls /path/to/files`
- Проверьте настройки `allowedPaths` в config.json

### 502 Bad Gateway

- Проверьте, что сервер запущен: `pm2 status` или `systemctl status webcommander`
- Проверьте порт в config.json и Nginx конфигурации

### Медленная работа

- Увеличьте `proxy_read_timeout` в Nginx
- Проверьте нагрузку на сервер: `htop`
- Рассмотрите использование SSD для хранилища

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи
2. Проверьте конфигурацию
3. Проверьте права доступа
4. Создайте issue в репозитории

---

**Удачи с деплоем!** 🚀
