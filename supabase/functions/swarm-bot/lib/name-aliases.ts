const RU_DIMINUTIVES: Record<string, string[]> = {
  "александр": ["саша", "саня", "шура", "alex", "sasha"],
  "александра": ["саша", "саня", "шура", "alex", "sasha"],
  "алексей": ["лёша", "лёха", "алёша", "lesha", "lyosha"],
  "андрей": ["андрюша", "андрюха", "andrey", "andrei"],
  "анна": ["аня", "анечка", "ann", "anna"],
  "василий": ["вася", "васёк", "vasya", "vasek"],
  "виктор": ["витя", "виктор", "vit", "victor"],
  "виталий": ["витя", "виталик", "vitalik", "vital"],
  "владимир": ["вова", "вовка", "вова", "volodya", "vlad", "vladimir"],
  "дмитрий": ["дима", "димка", "митя", "dima", "dmitry"],
  "екатерина": ["катя", "катюша", "kate", "katya"],
  "елена": ["лена", "леночка", "lena", "elena"],
  "иван": ["ваня", "ванёк", "vanya", "ivan"],
  "ирина": ["ира", "ирочка", "ira", "irina"],
  "кирилл": ["кирюша", "kirill", "kiril"],
  "константин": ["костя", "kostya", "konstantin"],
  "мария": ["маша", "машенька", "masha", "maria", "mary"],
  "максим": ["макс", "max", "maxim"],
  "михаил": ["миша", "мишка", "misha", "mikhail", "michael"],
  "наталья": ["наташа", "ната", "natasha", "natalia"],
  "николай": ["коля", "колян", "kolya", "nikolay"],
  "ольга": ["оля", "olya", "olga"],
  "павел": ["паша", "пашка", "pasha", "pavel", "paul"],
  "пётр": ["петя", "petya", "petr", "peter"],
  "светлана": ["света", "светик", "sveta", "svetlana"],
  "сергей": ["серёжа", "серёга", "seryozha", "sergey", "sergei"],
  "татьяна": ["таня", "танюша", "tanya", "tatyana"],
  "юлия": ["юля", "yulia", "julia"],
};

const TRANSLIT: Record<string, string> = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "zh",
  "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
  "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts",
  "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
};

function translit(s: string): string {
  return s.toLowerCase().split("").map((c) => TRANSLIT[c] ?? c).join("");
}

const LATIN_TO_RU: Record<string, string[]> = {
  "vasily": ["василий", "вася"], "vasili": ["василий", "вася"],
  "alexander": ["александр", "саша"], "alexei": ["алексей", "лёша"],
  "mikhail": ["михаил", "миша"], "dmitry": ["дмитрий", "дима"],
  "sergey": ["сергей", "серёжа"], "nikolay": ["николай", "коля"],
  "andrei": ["андрей"], "pavel": ["павел", "паша"],
  "viktor": ["виктор", "витя"], "maxim": ["максим", "макс"],
};

export function generateNameAliases(firstName?: string, lastName?: string): string[] {
  const aliases = new Set<string>();
  const fn = firstName?.trim().toLowerCase() ?? "";
  const ln = lastName?.trim().toLowerCase() ?? "";

  // Basic parts
  if (fn) aliases.add(fn);
  if (ln) aliases.add(ln);
  if (fn && ln) {
    aliases.add(`${fn} ${ln[0]}`);
    aliases.add(`${fn[0]} ${ln}`);
    aliases.add(`${fn} ${ln}`);
  }

  // Russian diminutives
  if (fn && RU_DIMINUTIVES[fn]) {
    for (const d of RU_DIMINUTIVES[fn]) aliases.add(d);
  }

  // Transliteration (Cyrillic -> Latin)
  const isCyrillicFn = /[а-яёА-ЯЁ]/.test(fn);
  const isCyrillicLn = /[а-яёА-ЯЁ]/.test(ln);
  if (isCyrillicFn) aliases.add(translit(fn));
  if (isCyrillicLn) aliases.add(translit(ln));
  if (isCyrillicFn && isCyrillicLn) aliases.add(translit(fn) + " " + translit(ln));

  // Latin -> Russian reverse mapping
  if (!isCyrillicFn && fn && LATIN_TO_RU[fn]) {
    for (const r of LATIN_TO_RU[fn]) aliases.add(r);
  }

  // Clean up
  aliases.delete("");
  return [...aliases].filter((a) => a.length > 1);
}
