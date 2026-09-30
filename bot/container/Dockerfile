# Окружение одной встречи: виртуальный экран, виртуальная звуковая карта, браузер, ffmpeg.
#
# Одна встреча = один контейнер. PulseAudio-sink и дисплей — глобальные ресурсы: два бота в
# одном контейнере запишут друг друга.
#
# Контекст сборки — каталог bot/:
#   docker build -f bot/container/Dockerfile -t scriba-container bot/
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# В образе Playwright уже есть Xvfb и браузеры; PulseAudio и полноценный ffmpeg — нет.
# Проверено запуском: `command -v ffmpeg` и `command -v pactl` в базовом образе пусты
# (свой ffmpeg Playwright держит в /ms-playwright и наружу не выставляет).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       pulseaudio \
       pulseaudio-utils \
       ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# PulseAudio ругается на отсутствие machine-id и в некоторых сборках отказывается стартовать.
RUN head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' > /etc/machine-id

ENV DISPLAY=:99 \
    SCRIBA_SCREEN=1280x720x24 \
    SCRIBA_SINK_NAME=scriba \
    SCRIBA_OUTPUT_DIR=/recordings \
    SCRIBA_AUDIO_BITRATE_KBPS=32 \
    XDG_RUNTIME_DIR=/run/user/1001

WORKDIR /app

# Зависимости ставятся из лока: версия playwright обязана совпадать с тегом базового образа,
# иначе браузер из /ms-playwright не подойдёт и Playwright молча полезет качать свой.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY container/entrypoint.sh container/tone.html container/silence.html /opt/scriba/

RUN chmod +x /opt/scriba/entrypoint.sh \
  && mkdir -p /run/user/1001 /recordings \
  && chown -R pwuser:pwuser /run/user/1001 /recordings /app \
  && chmod 700 /run/user/1001

# Браузер ходит в интернет — под root ему там делать нечего.
USER pwuser

ENTRYPOINT ["/opt/scriba/entrypoint.sh"]
CMD ["sleep", "infinity"]
