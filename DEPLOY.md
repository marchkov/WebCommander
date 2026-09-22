# Инструкция по деплою DockCommander на сервер

## 🚀 Быстрый старт

### 1. Загрузка на сервер

```bash
# Скопируйте файлы на сервер через SCP, FTP или Git
scp -r dockcommander user@server:/opt/

# Или через Git
git clone <repository-url> /opt/dockcommander
```

### 2. Установка зависимостей

```bash
cd /opt/dockcommander
npm install
```

### 3. Настройка конфигурации

Отредактируйте `config.json`:

```bash
nano config.json
```

**Важные настройки:**
- Измените `rootPath` на нужную директорию
- Измените пароли пользователей
- Измените `sessionSecret` на случайную строку
- Настройте `allowedPaths` и `blockedPaths`

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
pm2 start server/index.js --name dockcommander

# Сохраните конфигурацию
pm2 save

# Настройте автозапуск
pm2 startup
```

**Полезные команды PM2:**
```bash
pm2 status              # Статус
pm2 logs dockcommander  # Логи
pm2 restart dockcommander  # Перезапуск
pm2 stop dockcommander     # Остановка
```

#### Вариант 2: Systemd

Создайте файл `/etc/systemd/system/dockcommander.service`:

```ini
[Unit]
Description=DockCommander File Manager
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/dockcommander
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
sudo systemctl enable dockcommander
sudo systemctl start dockcommander
sudo systemctl status dockcommander
```

## 🔐 Настройка Nginx reverse proxy

### 1. Установите Nginx

```bash
sudo apt update
sudo apt install nginx
```

### 2. Создайте конфигурацию

```bash
sudo nano /etc/nginx/sites-available/dockcommander
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
    access_log /var/log/nginx/dockcommander.access.log;
    error_log /var/log/nginx/dockcommander.error.log;

    # Proxy settings
    location / {
        proxy_pass http://localhost:3001;
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
sudo ln -s /etc/nginx/sites-available/dockcommander /etc/nginx/sites-enabled/
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
pm2 logs dockcommander

# Systemd
sudo journalctl -u dockcommander -f

# Nginx
sudo tail -f /var/log/nginx/dockcommander.access.log
sudo tail -f /var/log/nginx/dockcommander.error.log
```

### Ротация логов

Создайте `/etc/logrotate.d/dockcommander`:

```
/var/log/nginx/dockcommander.*.log {
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
cd /opt/dockcommander

# Остановите сервис
sudo systemctl stop dockcommander
# или: pm2 stop dockcommander

# Обновите код
git pull

# Установите новые зависимости
npm install

# Пересоберите фронтенд
npm run build

# Запустите сервис
sudo systemctl start dockcommander
# или: pm2 restart dockcommander
```

## 🐛 Решение проблем

### Сервер не запускается

```bash
# Проверьте логи
pm2 logs dockcommander
# или
sudo journalctl -u dockcommander -n 50

# Проверьте порт
sudo netstat -tulpn | grep 3001
```

### Нет доступа к файлам

- Проверьте права доступа: `ls -la /path/to/files`
- Убедитесь, что пользователь сервера имеет доступ: `sudo -u www-data ls /path/to/files`
- Проверьте настройки `allowedPaths` в config.json

### 502 Bad Gateway

- Проверьте, что сервер запущен: `pm2 status` или `systemctl status dockcommander`
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
