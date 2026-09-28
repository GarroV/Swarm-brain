# Окно входа аккаунта бота (T175): Chromium на виртуальном экране, который владелец видит в
# своём браузере через noVNC. Владелец сам вводит пароль и второй фактор — через бота, логи
# и файлы они не проходят. После закрытия браузера вход выгружается файлом storageState.
#
# Строится ПОВЕРХ образа встречи: тот же Chromium той же версии, что потом пойдёт на встречи,
# иначе Google увидит вход с одного браузера и сессию на другом. В образ встречи VNC не
# добавляется — ему незачем показывать свой экран.
#
#   docker build -f bot/container/Dockerfile -t scriba-login:dev bot/
#   docker build -f bot/container/login/Dockerfile --build-arg BOT_IMAGE=scriba-login:dev \
#     -t scriba-login-window:dev bot/
ARG BOT_IMAGE=scriba-container
FROM ${BOT_IMAGE}

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends x11vnc novnc websockify \
  && rm -rf /var/lib/apt/lists/*

COPY container/login/login.sh /opt/scriba/login.sh
RUN chmod +x /opt/scriba/login.sh && mkdir -p /account && chown pwuser:pwuser /account

USER pwuser
ENTRYPOINT ["/opt/scriba/login.sh"]
