/**
 * Default Routing Config
 *
 * All routing parameters as a TypeScript constant.
 * Users override via YAML config file.
 *
 * Scoring uses 14 weighted dimensions with sigmoid confidence calibration.
 *
 * Default model IDs updated for local-semantic-router:
 * - SIMPLE: groq/llama-3.3-70b-versatile
 * - MEDIUM: anthropic/claude-sonnet-4-6-20260315
 * - COMPLEX/REASONING: anthropic/claude-opus-4-6-20260315
 */

import type { RoutingConfig } from "./types.js";

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  version: "2.0",

  classifier: {
    llmModel: "", // Configured via YAML fallback_classifier (SEC-3)
    llmMaxTokens: 10,
    llmTemperature: 0,
    promptTruncationChars: 500,
    cacheTtlMs: 3_600_000, // 1 hour
  },

  scoring: {
    tokenCountThresholds: { simple: 50, complex: 500 },

    // Multilingual keywords: EN + ZH + JA + RU + DE + ES + PT + KO + AR
    codeKeywords: [
      // English
      "function",
      "class",
      "import",
      "def",
      "SELECT",
      "async",
      "await",
      "const",
      "let",
      "var",
      "return",
      "```",
      // Chinese
      "\u51FD\u6570",
      "\u7C7B",
      "\u5BFC\u5165",
      "\u5B9A\u4E49",
      "\u67E5\u8BE2",
      "\u5F02\u6B65",
      "\u7B49\u5F85",
      "\u5E38\u91CF",
      "\u53D8\u91CF",
      "\u8FD4\u56DE",
      // Japanese
      "\u95A2\u6570",
      "\u30AF\u30E9\u30B9",
      "\u30A4\u30F3\u30DD\u30FC\u30C8",
      "\u975E\u540C\u671F",
      "\u5B9A\u6570",
      "\u5909\u6570",
      // Russian
      "\u0444\u0443\u043D\u043A\u0446\u0438\u044F",
      "\u043A\u043B\u0430\u0441\u0441",
      "\u0438\u043C\u043F\u043E\u0440\u0442",
      "\u043E\u043F\u0440\u0435\u0434\u0435\u043B",
      "\u0437\u0430\u043F\u0440\u043E\u0441",
      "\u0430\u0441\u0438\u043D\u0445\u0440\u043E\u043D\u043D\u044B\u0439",
      "\u043E\u0436\u0438\u0434\u0430\u0442\u044C",
      "\u043A\u043E\u043D\u0441\u0442\u0430\u043D\u0442\u0430",
      "\u043F\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u0430\u044F",
      "\u0432\u0435\u0440\u043D\u0443\u0442\u044C",
      // German
      "funktion",
      "klasse",
      "importieren",
      "definieren",
      "abfrage",
      "asynchron",
      "erwarten",
      "konstante",
      "variable",
      "zur\u00FCckgeben",
      // Spanish
      "funci\u00F3n",
      "clase",
      "importar",
      "definir",
      "consulta",
      "as\u00EDncrono",
      "esperar",
      "constante",
      "variable",
      "retornar",
      // Portuguese
      "fun\u00E7\u00E3o",
      "classe",
      "importar",
      "definir",
      "consulta",
      "ass\u00EDncrono",
      "aguardar",
      "constante",
      "vari\u00E1vel",
      "retornar",
      // Korean
      "\uD568\uC218",
      "\uD074\uB798\uC2A4",
      "\uAC00\uC838\uC624\uAE30",
      "\uC815\uC758",
      "\uCFFC\uB9AC",
      "\uBE44\uB3D9\uAE30",
      "\uB300\uAE30",
      "\uC0C1\uC218",
      "\uBCC0\uC218",
      "\uBC18\uD658",
      // Arabic
      "\u062F\u0627\u0644\u0629",
      "\u0641\u0626\u0629",
      "\u0627\u0633\u062A\u064A\u0631\u0627\u062F",
      "\u062A\u0639\u0631\u064A\u0641",
      "\u0627\u0633\u062A\u0639\u0644\u0627\u0645",
      "\u063A\u064A\u0631 \u0645\u062A\u0632\u0627\u0645\u0646",
      "\u0627\u0646\u062A\u0638\u0627\u0631",
      "\u062B\u0627\u0628\u062A",
      "\u0645\u062A\u063A\u064A\u0631",
      "\u0625\u0631\u062C\u0627\u0639",
    ],
    reasoningKeywords: [
      // English
      "prove",
      "theorem",
      "derive",
      "step by step",
      "chain of thought",
      "formally",
      "mathematical",
      "proof",
      "logically",
      // Chinese
      "\u8BC1\u660E",
      "\u5B9A\u7406",
      "\u63A8\u5BFC",
      "\u9010\u6B65",
      "\u601D\u7EF4\u94FE",
      "\u5F62\u5F0F\u5316",
      "\u6570\u5B66",
      "\u903B\u8F91",
      // Japanese
      "\u8A3C\u660E",
      "\u5B9A\u7406",
      "\u5C0E\u51FA",
      "\u30B9\u30C6\u30C3\u30D7\u30D0\u30A4\u30B9\u30C6\u30C3\u30D7",
      "\u8AD6\u7406\u7684",
      // Russian
      "\u0434\u043E\u043A\u0430\u0437\u0430\u0442\u044C",
      "\u0434\u043E\u043A\u0430\u0436\u0438",
      "\u0434\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432",
      "\u0442\u0435\u043E\u0440\u0435\u043C\u0430",
      "\u0432\u044B\u0432\u0435\u0441\u0442\u0438",
      "\u0448\u0430\u0433 \u0437\u0430 \u0448\u0430\u0433\u043E\u043C",
      "\u043F\u043E\u0448\u0430\u0433\u043E\u0432\u043E",
      "\u043F\u043E\u044D\u0442\u0430\u043F\u043D\u043E",
      "\u0446\u0435\u043F\u043E\u0447\u043A\u0430 \u0440\u0430\u0441\u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0439",
      "\u0440\u0430\u0441\u0441\u0443\u0436\u0434\u0435\u043D\u0438",
      "\u0444\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u043E",
      "\u043C\u0430\u0442\u0435\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438",
      "\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438",
      // German
      "beweisen",
      "beweis",
      "theorem",
      "ableiten",
      "schritt f\u00FCr schritt",
      "gedankenkette",
      "formal",
      "mathematisch",
      "logisch",
      // Spanish
      "demostrar",
      "teorema",
      "derivar",
      "paso a paso",
      "cadena de pensamiento",
      "formalmente",
      "matem\u00E1tico",
      "prueba",
      "l\u00F3gicamente",
      // Portuguese
      "provar",
      "teorema",
      "derivar",
      "passo a passo",
      "cadeia de pensamento",
      "formalmente",
      "matem\u00E1tico",
      "prova",
      "logicamente",
      // Korean
      "\uC99D\uBA85",
      "\uC815\uB9AC",
      "\uB3C4\uCD9C",
      "\uB2E8\uACC4\uBCC4",
      "\uC0AC\uACE0\uC758 \uC5F0\uC1C4",
      "\uD615\uC2DD\uC801",
      "\uC218\uD559\uC801",
      "\uB17C\uB9AC\uC801",
      // Arabic
      "\u0625\u062B\u0628\u0627\u062A",
      "\u0646\u0638\u0631\u064A\u0629",
      "\u0627\u0634\u062A\u0642\u0627\u0642",
      "\u062E\u0637\u0648\u0629 \u0628\u062E\u0637\u0648\u0629",
      "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u062A\u0641\u0643\u064A\u0631",
      "\u0631\u0633\u0645\u064A\u0627\u064B",
      "\u0631\u064A\u0627\u0636\u064A",
      "\u0628\u0631\u0647\u0627\u0646",
      "\u0645\u0646\u0637\u0642\u064A\u0627\u064B",
    ],
    simpleKeywords: [
      // English
      "what is",
      "define",
      "translate",
      "hello",
      "yes or no",
      "capital of",
      "how old",
      "who is",
      "when was",
      // Chinese
      "\u4EC0\u4E48\u662F",
      "\u5B9A\u4E49",
      "\u7FFB\u8BD1",
      "\u4F60\u597D",
      "\u662F\u5426",
      "\u9996\u90FD",
      "\u591A\u5927",
      "\u8C01\u662F",
      "\u4F55\u65F6",
      // Japanese
      "\u3068\u306F",
      "\u5B9A\u7FA9",
      "\u7FFB\u8A33",
      "\u3053\u3093\u306B\u3061\u306F",
      "\u306F\u3044\u304B\u3044\u3044\u3048",
      "\u9996\u90FD",
      "\u8AB0",
      // Russian
      "\u0447\u0442\u043E \u0442\u0430\u043A\u043E\u0435",
      "\u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435",
      "\u043F\u0435\u0440\u0435\u0432\u0435\u0441\u0442\u0438",
      "\u043F\u0435\u0440\u0435\u0432\u0435\u0434\u0438",
      "\u043F\u0440\u0438\u0432\u0435\u0442",
      "\u0434\u0430 \u0438\u043B\u0438 \u043D\u0435\u0442",
      "\u0441\u0442\u043E\u043B\u0438\u0446\u0430",
      "\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043B\u0435\u0442",
      "\u043A\u0442\u043E \u0442\u0430\u043A\u043E\u0439",
      "\u043A\u043E\u0433\u0434\u0430",
      "\u043E\u0431\u044A\u044F\u0441\u043D\u0438",
      // German
      "was ist",
      "definiere",
      "\u00FCbersetze",
      "hallo",
      "ja oder nein",
      "hauptstadt",
      "wie alt",
      "wer ist",
      "wann",
      "erkl\u00E4re",
      // Spanish
      "qu\u00E9 es",
      "definir",
      "traducir",
      "hola",
      "s\u00ED o no",
      "capital de",
      "cu\u00E1ntos a\u00F1os",
      "qui\u00E9n es",
      "cu\u00E1ndo",
      // Portuguese
      "o que \u00E9",
      "definir",
      "traduzir",
      "ol\u00E1",
      "sim ou n\u00E3o",
      "capital de",
      "quantos anos",
      "quem \u00E9",
      "quando",
      // Korean
      "\uBB34\uC5C7",
      "\uC815\uC758",
      "\uBC88\uC5ED",
      "\uC548\uB155\uD558\uC138\uC694",
      "\uC608 \uB610\uB294 \uC544\uB2C8\uC624",
      "\uC218\uB3C4",
      "\uB204\uAD6C",
      "\uC5B8\uC81C",
      // Arabic
      "\u0645\u0627 \u0647\u0648",
      "\u062A\u0639\u0631\u064A\u0641",
      "\u062A\u0631\u062C\u0645",
      "\u0645\u0631\u062D\u0628\u0627",
      "\u0646\u0639\u0645 \u0623\u0648 \u0644\u0627",
      "\u0639\u0627\u0635\u0645\u0629",
      "\u0645\u0646 \u0647\u0648",
      "\u0645\u062A\u0649",
    ],
    technicalKeywords: [
      // English
      "algorithm",
      "optimize",
      "architecture",
      "distributed",
      "kubernetes",
      "microservice",
      "database",
      "infrastructure",
      // Chinese
      "\u7B97\u6CD5",
      "\u4F18\u5316",
      "\u67B6\u6784",
      "\u5206\u5E03\u5F0F",
      "\u5FAE\u670D\u52A1",
      "\u6570\u636E\u5E93",
      "\u57FA\u7840\u8BBE\u65BD",
      // Japanese
      "\u30A2\u30EB\u30B4\u30EA\u30BA\u30E0",
      "\u6700\u9069\u5316",
      "\u30A2\u30FC\u30AD\u30C6\u30AF\u30C1\u30E3",
      "\u5206\u6563",
      "\u30DE\u30A4\u30AF\u30ED\u30B5\u30FC\u30D3\u30B9",
      "\u30C7\u30FC\u30BF\u30D9\u30FC\u30B9",
      // Russian
      "\u0430\u043B\u0433\u043E\u0440\u0438\u0442\u043C",
      "\u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
      "\u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0430\u0446\u0438",
      "\u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0438\u0440\u0443\u0439",
      "\u0430\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u0443\u0440\u0430",
      "\u0440\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0451\u043D\u043D\u044B\u0439",
      "\u043C\u0438\u043A\u0440\u043E\u0441\u0435\u0440\u0432\u0438\u0441",
      "\u0431\u0430\u0437\u0430 \u0434\u0430\u043D\u043D\u044B\u0445",
      "\u0438\u043D\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430",
      // German
      "algorithmus",
      "optimieren",
      "architektur",
      "verteilt",
      "kubernetes",
      "mikroservice",
      "datenbank",
      "infrastruktur",
      // Spanish
      "algoritmo",
      "optimizar",
      "arquitectura",
      "distribuido",
      "microservicio",
      "base de datos",
      "infraestructura",
      // Portuguese
      "algoritmo",
      "otimizar",
      "arquitetura",
      "distribu\u00EDdo",
      "microsservi\u00E7o",
      "banco de dados",
      "infraestrutura",
      // Korean
      "\uC54C\uACE0\uB9AC\uC998",
      "\uCD5C\uC801\uD654",
      "\uC544\uD0A4\uD14D\uCC98",
      "\uBD84\uC0B0",
      "\uB9C8\uC774\uD06C\uB85C\uC11C\uBE44\uC2A4",
      "\uB370\uC774\uD130\uBCA0\uC774\uC2A4",
      "\uC778\uD504\uB77C",
      // Arabic
      "\u062E\u0648\u0627\u0631\u0632\u0645\u064A\u0629",
      "\u062A\u062D\u0633\u064A\u0646",
      "\u0628\u0646\u064A\u0629",
      "\u0645\u0648\u0632\u0639",
      "\u062E\u062F\u0645\u0629 \u0645\u0635\u063A\u0631\u0629",
      "\u0642\u0627\u0639\u062F\u0629 \u0628\u064A\u0627\u0646\u0627\u062A",
      "\u0628\u0646\u064A\u0629 \u062A\u062D\u062A\u064A\u0629",
    ],
    creativeKeywords: [
      // English
      "story",
      "poem",
      "compose",
      "brainstorm",
      "creative",
      "imagine",
      "write a",
      // Chinese
      "\u6545\u4E8B",
      "\u8BD7",
      "\u521B\u4F5C",
      "\u5934\u8111\u98CE\u66B4",
      "\u521B\u610F",
      "\u60F3\u8C61",
      "\u5199\u4E00\u4E2A",
      // Japanese
      "\u7269\u8A9E",
      "\u8A69",
      "\u4F5C\u66F2",
      "\u30D6\u30EC\u30A4\u30F3\u30B9\u30C8\u30FC\u30E0",
      "\u5275\u9020\u7684",
      "\u60F3\u50CF",
      // Russian
      "\u0438\u0441\u0442\u043E\u0440\u0438\u044F",
      "\u0440\u0430\u0441\u0441\u043A\u0430\u0437",
      "\u0441\u0442\u0438\u0445\u043E\u0442\u0432\u043E\u0440\u0435\u043D\u0438\u0435",
      "\u0441\u043E\u0447\u0438\u043D\u0438\u0442\u044C",
      "\u0441\u043E\u0447\u0438\u043D\u0438",
      "\u043C\u043E\u0437\u0433\u043E\u0432\u043E\u0439 \u0448\u0442\u0443\u0440\u043C",
      "\u0442\u0432\u043E\u0440\u0447\u0435\u0441\u043A\u0438\u0439",
      "\u043F\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u044C",
      "\u043F\u0440\u0438\u0434\u0443\u043C\u0430\u0439",
      "\u043D\u0430\u043F\u0438\u0448\u0438",
      // German
      "geschichte",
      "gedicht",
      "komponieren",
      "brainstorming",
      "kreativ",
      "vorstellen",
      "schreibe",
      "erz\u00E4hlung",
      // Spanish
      "historia",
      "poema",
      "componer",
      "lluvia de ideas",
      "creativo",
      "imaginar",
      "escribe",
      // Portuguese
      "hist\u00F3ria",
      "poema",
      "compor",
      "criativo",
      "imaginar",
      "escreva",
      // Korean
      "\uC774\uC57C\uAE30",
      "\uC2DC",
      "\uC791\uACE1",
      "\uBE0C\uB808\uC778\uC2A4\uD1A0\uBC0D",
      "\uCC3D\uC758\uC801",
      "\uC0C1\uC0C1",
      "\uC791\uC131",
      // Arabic
      "\u0642\u0635\u0629",
      "\u0642\u0635\u064A\u062F\u0629",
      "\u062A\u0623\u0644\u064A\u0641",
      "\u0639\u0635\u0641 \u0630\u0647\u0646\u064A",
      "\u0625\u0628\u062F\u0627\u0639\u064A",
      "\u062A\u062E\u064A\u0644",
      "\u0627\u0643\u062A\u0628",
    ],

    // New dimension keyword lists (multilingual)
    imperativeVerbs: [
      "build", "create", "implement", "design", "develop", "construct", "generate", "deploy", "configure", "set up",
      "\u6784\u5EFA", "\u521B\u5EFA", "\u5B9E\u73B0", "\u8BBE\u8BA1", "\u5F00\u53D1", "\u751F\u6210", "\u90E8\u7F72", "\u914D\u7F6E", "\u8BBE\u7F6E",
      "\u69CB\u7BC9", "\u4F5C\u6210", "\u5B9F\u88C5", "\u8A2D\u8A08", "\u958B\u767A", "\u751F\u6210", "\u30C7\u30D7\u30ED\u30A4", "\u8A2D\u5B9A",
      "\u043F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C", "\u043F\u043E\u0441\u0442\u0440\u043E\u0439", "\u0441\u043E\u0437\u0434\u0430\u0442\u044C", "\u0441\u043E\u0437\u0434\u0430\u0439", "\u0440\u0435\u0430\u043B\u0438\u0437\u043E\u0432\u0430\u0442\u044C", "\u0440\u0435\u0430\u043B\u0438\u0437\u0443\u0439",
      "\u0441\u043F\u0440\u043E\u0435\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "\u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C", "\u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0430\u0439", "\u0441\u043A\u043E\u043D\u0441\u0442\u0440\u0443\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
      "\u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C", "\u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u0439", "\u0440\u0430\u0437\u0432\u0435\u0440\u043D\u0443\u0442\u044C", "\u0440\u0430\u0437\u0432\u0435\u0440\u043D\u0438", "\u043D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C", "\u043D\u0430\u0441\u0442\u0440\u043E\u0439",
      "erstellen", "bauen", "implementieren", "entwerfen", "entwickeln", "konstruieren", "generieren", "bereitstellen", "konfigurieren", "einrichten",
      "construir", "crear", "implementar", "dise\u00F1ar", "desarrollar", "generar", "desplegar", "configurar",
      "construir", "criar", "implementar", "projetar", "desenvolver", "gerar", "implantar", "configurar",
      "\uAD6C\uCD95", "\uC0DD\uC131", "\uAD6C\uD604", "\uC124\uACC4", "\uAC1C\uBC1C", "\uBC30\uD3EC", "\uC124\uC815",
      "\u0628\u0646\u0627\u0621", "\u0625\u0646\u0634\u0627\u0621", "\u062A\u0646\u0641\u064A\u0630", "\u062A\u0635\u0645\u064A\u0645", "\u062A\u0637\u0648\u064A\u0631", "\u062A\u0648\u0644\u064A\u062F", "\u0646\u0634\u0631", "\u0625\u0639\u062F\u0627\u062F",
    ],
    constraintIndicators: [
      "under", "at most", "at least", "within", "no more than", "o(", "maximum", "minimum", "limit", "budget",
      "\u4E0D\u8D85\u8FC7", "\u81F3\u5C11", "\u6700\u591A", "\u5728\u5185", "\u6700\u5927", "\u6700\u5C0F", "\u9650\u5236", "\u9884\u7B97",
      "\u4EE5\u4E0B", "\u6700\u5927", "\u6700\u5C0F", "\u5236\u9650", "\u4E88\u7B97",
      "\u043D\u0435 \u0431\u043E\u043B\u0435\u0435", "\u043D\u0435 \u043C\u0435\u043D\u0435\u0435", "\u043A\u0430\u043A \u043C\u0438\u043D\u0438\u043C\u0443\u043C", "\u0432 \u043F\u0440\u0435\u0434\u0435\u043B\u0430\u0445", "\u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C", "\u043C\u0438\u043D\u0438\u043C\u0443\u043C", "\u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0435", "\u0431\u044E\u0434\u0436\u0435\u0442",
      "h\u00F6chstens", "mindestens", "innerhalb", "nicht mehr als", "maximal", "minimal", "grenze", "budget",
      "como m\u00E1ximo", "al menos", "dentro de", "no m\u00E1s de", "m\u00E1ximo", "m\u00EDnimo", "l\u00EDmite", "presupuesto",
      "no m\u00E1ximo", "pelo menos", "dentro de", "n\u00E3o mais que", "m\u00E1ximo", "m\u00EDnimo", "limite", "or\u00E7amento",
      "\uC774\uD558", "\uC774\uC0C1", "\uCD5C\uB300", "\uCD5C\uC18C", "\uC81C\uD55C", "\uC608\uC0B0",
      "\u0639\u0644\u0649 \u0627\u0644\u0623\u0643\u062B\u0631", "\u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644", "\u0636\u0645\u0646", "\u0644\u0627 \u064A\u0632\u064A\u062F \u0639\u0646", "\u0623\u0642\u0635\u0649", "\u0623\u062F\u0646\u0649", "\u062D\u062F", "\u0645\u064A\u0632\u0627\u0646\u064A\u0629",
    ],
    outputFormatKeywords: [
      "json", "yaml", "xml", "table", "csv", "markdown", "schema", "format as", "structured",
      "\u8868\u683C", "\u683C\u5F0F\u5316\u4E3A", "\u7ED3\u6784\u5316",
      "\u30C6\u30FC\u30D6\u30EB", "\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8", "\u69CB\u9020\u5316",
      "\u0442\u0430\u0431\u043B\u0438\u0446\u0430", "\u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u0430\u043A", "\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439",
      "tabelle", "formatieren als", "strukturiert",
      "tabla", "formatear como", "estructurado",
      "tabela", "formatar como", "estruturado",
      "\uD14C\uC774\uBE14", "\uD615\uC2DD", "\uAD6C\uC870\uD654",
      "\u062C\u062F\u0648\u0644", "\u062A\u0646\u0633\u064A\u0642", "\u0645\u0646\u0638\u0645",
    ],
    referenceKeywords: [
      "above", "below", "previous", "following", "the docs", "the api", "the code", "earlier", "attached",
      "\u4E0A\u9762", "\u4E0B\u9762", "\u4E4B\u524D", "\u63A5\u4E0B\u6765", "\u6587\u6863", "\u4EE3\u7801", "\u9644\u4EF6",
      "\u4E0A\u8A18", "\u4E0B\u8A18", "\u524D\u306E", "\u6B21\u306E", "\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8", "\u30B3\u30FC\u30C9",
      "\u0432\u044B\u0448\u0435", "\u043D\u0438\u0436\u0435", "\u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0438\u0439", "\u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439", "\u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u0446\u0438\u044F", "\u043A\u043E\u0434", "\u0440\u0430\u043D\u0435\u0435", "\u0432\u043B\u043E\u0436\u0435\u043D\u0438\u0435",
      "oben", "unten", "vorherige", "folgende", "dokumentation", "der code", "fr\u00FCher", "anhang",
      "arriba", "abajo", "anterior", "siguiente", "documentaci\u00F3n", "el c\u00F3digo", "adjunto",
      "acima", "abaixo", "anterior", "seguinte", "documenta\u00E7\u00E3o", "o c\u00F3digo", "anexo",
      "\uC704", "\uC544\uB798", "\uC774\uC804", "\uB2E4\uC74C", "\uBB38\uC11C", "\uCF54\uB4DC", "\uCCA8\uBD80",
      "\u0623\u0639\u0644\u0627\u0647", "\u0623\u062F\u0646\u0627\u0647", "\u0627\u0644\u0633\u0627\u0628\u0642", "\u0627\u0644\u062A\u0627\u0644\u064A", "\u0627\u0644\u0648\u062B\u0627\u0626\u0642", "\u0627\u0644\u0643\u0648\u062F", "\u0645\u0631\u0641\u0642",
    ],
    negationKeywords: [
      "don't", "do not", "avoid", "never", "without", "except", "exclude", "no longer",
      "\u4E0D\u8981", "\u907F\u514D", "\u4ECE\u4E0D", "\u6CA1\u6709", "\u9664\u4E86", "\u6392\u9664",
      "\u3057\u306A\u3044\u3067", "\u907F\u3051\u308B", "\u6C7A\u3057\u3066", "\u306A\u3057\u3067", "\u9664\u304F",
      "\u043D\u0435 \u0434\u0435\u043B\u0430\u0439", "\u043D\u0435 \u043D\u0430\u0434\u043E", "\u043D\u0435\u043B\u044C\u0437\u044F", "\u0438\u0437\u0431\u0435\u0433\u0430\u0442\u044C", "\u043D\u0438\u043A\u043E\u0433\u0434\u0430", "\u0431\u0435\u0437", "\u043A\u0440\u043E\u043C\u0435", "\u0438\u0441\u043A\u043B\u044E\u0447\u0438\u0442\u044C", "\u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435",
      "nicht", "vermeide", "niemals", "ohne", "au\u00DFer", "ausschlie\u00DFen", "nicht mehr",
      "no hagas", "evitar", "nunca", "sin", "excepto", "excluir",
      "n\u00E3o fa\u00E7a", "evitar", "nunca", "sem", "exceto", "excluir",
      "\uD558\uC9C0 \uB9C8", "\uD53C\uD558\uB2E4", "\uC808\uB300", "\uC5C6\uC774", "\uC81C\uC678",
      "\u0644\u0627 \u062A\u0641\u0639\u0644", "\u062A\u062C\u0646\u0628", "\u0623\u0628\u062F\u0627\u064B", "\u0628\u062F\u0648\u0646", "\u0628\u0627\u0633\u062A\u062B\u0646\u0627\u0621", "\u0627\u0633\u062A\u0628\u0639\u0627\u062F",
    ],
    domainSpecificKeywords: [
      "quantum", "fpga", "vlsi", "risc-v", "asic", "photonics", "genomics", "proteomics", "topological", "homomorphic", "zero-knowledge", "lattice-based",
      "\u91CF\u5B50", "\u5149\u5B50\u5B66", "\u57FA\u56E0\u7EC4\u5B66", "\u86CB\u767D\u8D28\u7EC4\u5B66", "\u62D3\u6251", "\u540C\u6001", "\u96F6\u77E5\u8BC6", "\u683C\u5BC6\u7801",
      "\u91CF\u5B50", "\u30D5\u30A9\u30C8\u30CB\u30AF\u30B9", "\u30B2\u30CE\u30DF\u30AF\u30B9", "\u30C8\u30DD\u30ED\u30B8\u30AB\u30EB",
      "\u043A\u0432\u0430\u043D\u0442\u043E\u0432\u044B\u0439", "\u0444\u043E\u0442\u043E\u043D\u0438\u043A\u0430", "\u0433\u0435\u043D\u043E\u043C\u0438\u043A\u0430", "\u043F\u0440\u043E\u0442\u0435\u043E\u043C\u0438\u043A\u0430", "\u0442\u043E\u043F\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0439", "\u0433\u043E\u043C\u043E\u043C\u043E\u0440\u0444\u043D\u044B\u0439", "\u0441 \u043D\u0443\u043B\u0435\u0432\u044B\u043C \u0440\u0430\u0437\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435\u043C", "\u043D\u0430 \u043E\u0441\u043D\u043E\u0432\u0435 \u0440\u0435\u0448\u0451\u0442\u043E\u043A",
      "quanten", "photonik", "genomik", "proteomik", "topologisch", "homomorph", "zero-knowledge", "gitterbasiert",
      "cu\u00E1ntico", "fot\u00F3nica", "gen\u00F3mica", "prote\u00F3mica", "topol\u00F3gico", "homomorf\u00EDco",
      "qu\u00E2ntico", "fot\u00F4nica", "gen\u00F4mica", "prote\u00F4mica", "topol\u00F3gico", "homomorf\u00EDco",
      "\uC591\uC790", "\uD3EC\uD1A0\uB2C9\uC2A4", "\uC720\uC804\uCCB4\uD559", "\uC704\uC0C1", "\uB3D9\uD615",
      "\u0643\u0645\u064A", "\u0636\u0648\u0626\u064A\u0627\u062A", "\u062C\u064A\u0646\u0648\u0645\u064A\u0627\u062A", "\u0637\u0648\u0628\u0648\u0644\u0648\u062C\u064A", "\u062A\u0645\u0627\u062B\u0644\u064A",
    ],

    // Agentic task keywords
    agenticTaskKeywords: [
      "read file", "read the file", "look at", "check the", "open the", "edit", "modify", "update the", "change the", "write to", "create file",
      "execute", "deploy", "install", "npm", "pip", "compile",
      "after that", "and also", "once done", "step 1", "step 2",
      "fix", "debug", "until it works", "keep trying", "iterate", "make sure", "verify", "confirm",
      "\u8BFB\u53D6\u6587\u4EF6", "\u67E5\u770B", "\u6253\u5F00", "\u7F16\u8F91", "\u4FEE\u6539", "\u66F4\u65B0", "\u521B\u5EFA", "\u6267\u884C", "\u90E8\u7F72", "\u5B89\u88C5", "\u7B2C\u4E00\u6B65", "\u7B2C\u4E8C\u6B65", "\u4FEE\u590D", "\u8C03\u8BD5", "\u76F4\u5230", "\u786E\u8BA4", "\u9A8C\u8BC1",
      "leer archivo", "editar", "modificar", "actualizar", "ejecutar", "desplegar", "instalar", "paso 1", "paso 2", "arreglar", "depurar", "verificar",
      "ler arquivo", "editar", "modificar", "atualizar", "executar", "implantar", "instalar", "passo 1", "passo 2", "corrigir", "depurar", "verificar",
      "\uD30C\uC77C \uC77D\uAE30", "\uD3B8\uC9D1", "\uC218\uC815", "\uC5C5\uB370\uC774\uD2B8", "\uC2E4\uD589", "\uBC30\uD3EC", "\uC124\uCE58", "\uB2E8\uACC4 1", "\uB2E8\uACC4 2", "\uB514\uBC84\uADF8", "\uD655\uC778",
      "\u0642\u0631\u0627\u0621\u0629 \u0645\u0644\u0641", "\u062A\u062D\u0631\u064A\u0631", "\u062A\u0639\u062F\u064A\u0644", "\u062A\u062D\u062F\u064A\u062B", "\u062A\u0646\u0641\u064A\u0630", "\u0646\u0634\u0631", "\u062A\u062B\u0628\u064A\u062A", "\u0627\u0644\u062E\u0637\u0648\u0629 1", "\u0627\u0644\u062E\u0637\u0648\u0629 2", "\u0625\u0635\u0644\u0627\u062D", "\u062A\u0635\u062D\u064A\u062D", "\u062A\u062D\u0642\u0642",
    ],

    // Dimension weights (sum to 1.0)
    dimensionWeights: {
      tokenCount: 0.08,
      codePresence: 0.15,
      reasoningMarkers: 0.18,
      technicalTerms: 0.1,
      creativeMarkers: 0.05,
      simpleIndicators: 0.02,
      multiStepPatterns: 0.12,
      questionComplexity: 0.05,
      imperativeVerbs: 0.03,
      constraintCount: 0.04,
      outputFormat: 0.03,
      referenceComplexity: 0.02,
      negationComplexity: 0.01,
      domainSpecificity: 0.02,
      agenticTask: 0.04,
    },

    // Tier boundaries on weighted score axis
    tierBoundaries: {
      simpleMedium: 0.0,
      mediumComplex: 0.3,
      complexReasoning: 0.5,
    },

    // Sigmoid steepness for confidence calibration
    confidenceSteepness: 12,
    // Below this confidence → ambiguous (null tier)
    confidenceThreshold: 0.7,
  },

  // Auto (balanced) tier configs — updated for local-semantic-router defaults
  tiers: {
    SIMPLE: {
      primary: "groq/llama-3.3-70b-versatile",
      fallback: [
        "anthropic/claude-sonnet-4-6-20260315",
      ],
    },
    MEDIUM: {
      primary: "anthropic/claude-sonnet-4-6-20260315",
      fallback: [
        "groq/llama-3.3-70b-versatile",
      ],
    },
    COMPLEX: {
      primary: "anthropic/claude-opus-4-6-20260315",
      fallback: [
        "anthropic/claude-sonnet-4-6-20260315",
        "groq/llama-3.3-70b-versatile",
      ],
    },
    REASONING: {
      primary: "anthropic/claude-opus-4-6-20260315",
      fallback: [
        "anthropic/claude-sonnet-4-6-20260315",
      ],
    },
  },

  // Eco tier configs
  ecoTiers: {
    SIMPLE: {
      primary: "groq/llama-3.3-70b-versatile",
      fallback: [],
    },
    MEDIUM: {
      primary: "groq/llama-3.3-70b-versatile",
      fallback: [],
    },
    COMPLEX: {
      primary: "groq/llama-3.3-70b-versatile",
      fallback: [
        "anthropic/claude-sonnet-4-6-20260315",
      ],
    },
    REASONING: {
      primary: "anthropic/claude-sonnet-4-6-20260315",
      fallback: [
        "groq/llama-3.3-70b-versatile",
      ],
    },
  },

  // Premium tier configs
  premiumTiers: {
    SIMPLE: {
      primary: "anthropic/claude-sonnet-4-6-20260315",
      fallback: [
        "groq/llama-3.3-70b-versatile",
      ],
    },
    MEDIUM: {
      primary: "anthropic/claude-sonnet-4-6-20260315",
      fallback: [
        "anthropic/claude-opus-4-6-20260315",
      ],
    },
    COMPLEX: {
      primary: "anthropic/claude-opus-4-6-20260315",
      fallback: [
        "anthropic/claude-sonnet-4-6-20260315",
      ],
    },
    REASONING: {
      primary: "anthropic/claude-opus-4-6-20260315",
      fallback: [
        "anthropic/claude-sonnet-4-6-20260315",
      ],
    },
  },

  // Agentic tier configs
  agenticTiers: {
    SIMPLE: {
      primary: "groq/llama-3.3-70b-versatile",
      fallback: [
        "anthropic/claude-sonnet-4-6-20260315",
      ],
    },
    MEDIUM: {
      primary: "anthropic/claude-sonnet-4-6-20260315",
      fallback: [
        "groq/llama-3.3-70b-versatile",
      ],
    },
    COMPLEX: {
      primary: "anthropic/claude-sonnet-4-6-20260315",
      fallback: [
        "anthropic/claude-opus-4-6-20260315",
      ],
    },
    REASONING: {
      primary: "anthropic/claude-opus-4-6-20260315",
      fallback: [
        "anthropic/claude-sonnet-4-6-20260315",
      ],
    },
  },

  overrides: {
    maxTokensForceComplex: 100_000,
    structuredOutputMinTier: "MEDIUM",
    ambiguousDefaultTier: "MEDIUM",
    agenticMode: false,
  },
};
