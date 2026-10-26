// Последняя сборка рекордера (bumblebee) и контрольная сумма её архива — одно место на обе раздачи:
// функцию версий (авто-апдейт, swarm-recorder-version) и установщик (swarm-recorder-setup).
//
// Почему сумма здесь, а не рядом с архивом (#203): архив лежит в публичном бакете Storage, и его
// подмена в бакете иначе прошла бы молча — апдейтер переподписывает скачанное своим cert'ом и
// запускает на машинах всей команды. Этот файл меняется только через git и CI, поэтому для подмены
// нужен и бакет, и код. Апдейтер (с build 37) и установщик сверяют сумму ДО распаковки.
//
// Поднимать вместе, ОДНИМ коммитом: номер — только после того, как `recorder-release.yml` собрал
// архив; сумму брать из сводки его прогона (или `shasum -a 256` скачанного из релиза на GitHub —
// у ассета там своя, независимая от бакета сумма) и сверить с копией в бакете. Раскатать обе функции.
// История сборок — в шапке swarm-recorder-version/index.ts.
import { STORAGE_PUBLIC_URL } from "./public-url.ts";
export const RECORDER_LATEST_BUILD = 38;
export const RECORDER_ASSET_SHA256 = "1e4484b3cc7fccc00b2a3ce94c557e3fcc102c282044ab2381f119e34144389d";

export const RECORDER_ASSET_BASE = `${STORAGE_PUBLIC_URL}/swarm_drive/recorder`;

export function recorderAssetUrl(build: number): string {
  return `${RECORDER_ASSET_BASE}/SwarmRecorder-${build}.zip`;
}
