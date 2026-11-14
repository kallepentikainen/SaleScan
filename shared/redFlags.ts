/**
 * On-device sales-pressure and scam pattern detection (English + Finnish).
 * Runs instantly, offline, and never sends anything anywhere. It powers the
 * live alerts during a conversation and the fallback verdict when the AI
 * analysis is unavailable.
 */
import type { Analysis, AnalyzeRequest, Lang, RedFlag, Severity, Verdict } from "./types.ts";

interface Pattern {
  id: string;
  severity: Severity;
  weight: number;
  label: Record<Lang, string>;
  tip: Record<Lang, string>;
  why: Record<Lang, string>;
  re: RegExp[];
}

export const PATTERNS: Pattern[] = [
  {
    id: "urgency",
    severity: "medium",
    weight: 18,
    label: { en: "Artificial urgency", fi: "Keinotekoinen kiire" },
    tip: { en: "Time pressure. Don't decide today.", fi: "Aikapainetta. Älä päätä tänään." },
    why: {
      en: "Deadlines that exist only in the pitch push you to skip comparison and reflection.",
      fi: "Vain myyntipuheessa olevat takarajat saavat ohittamaan vertailun ja harkinnan.",
    },
    re: [
      /\b(today only|only (for )?today|offer ends|expires (today|tonight)|last chance|limited[- ]time|before (it'?s|they'?re) gone|price goes up tomorrow|only valid (now|today))\b/i,
      /(vain tänään|ainoastaan tänään|tarjous päättyy|viimeinen mahdollisuus|rajoitetun ajan|huomenna hinta nousee|voimassa vain tänään|tänään on viimeinen)/i,
    ],
  },
  {
    id: "scarcity",
    severity: "medium",
    weight: 14,
    label: { en: "Scarcity pressure", fi: "Niukkuudella painostus" },
    tip: { en: "Scarcity claim. Verify it.", fi: "Niukkuusväite. Tarkista se." },
    why: {
      en: "Claims that stock is running out or someone else is about to buy are hard to verify and often invented.",
      fi: "Väitteitä loppuvasta varastosta tai toisesta ostajasta on vaikea tarkistaa, ja ne ovat usein keksittyjä.",
    },
    re: [
      /\b(only (one|two|three|\d+) left|last (one|unit|piece)|selling fast|someone else is (interested|coming)|another buyer|won'?t last)\b/i,
      /(vain (yksi|kaksi|kolme|\d+) jäljellä|viimeinen kappale|toinen ostaja|joku muu on kiinnostunut|menee kuin kuumille kiville|loppuu pian)/i,
    ],
  },
  {
    id: "sign_now",
    severity: "high",
    weight: 22,
    label: { en: "Pressure to sign now", fi: "Painostus allekirjoittamaan heti" },
    tip: { en: "Pressure to sign. Ask for time.", fi: "Painostusta allekirjoittaa. Pyydä miettimisaikaa." },
    why: {
      en: "A fair offer survives a night's sleep. Pushing for a signature on the spot is a classic high-pressure tactic.",
      fi: "Reilu tarjous kestää yön yli miettimisen. Allekirjoituksen vaatiminen paikan päällä on klassinen painostuskeino.",
    },
    re: [
      /\b(sign (it |this )?(now|here|today)|decide (right )?now|need (an|your) answer (now|today)|can'?t hold (this|the) (price|offer)|just sign)\b/i,
      /(allekirjoita (nyt|tähän|heti)|päätös pitää tehdä (nyt|heti|tänään)|tarvitsen vastauksen (nyt|tänään)|en voi pitää (hintaa|tarjousta)|laita vaan nimi)/i,
    ],
  },
  {
    id: "isolation",
    severity: "high",
    weight: 24,
    label: { en: "Discouraging outside advice", fi: "Ulkopuolisen neuvon torjuminen" },
    tip: { en: "They don't want you to check. Red flag.", fi: "Ei halua, että tarkistat. Varoitusmerkki." },
    why: {
      en: "Honest sellers don't mind you asking family, reading the contract or comparing offers.",
      fi: "Rehellinen myyjä ei pahastu, jos kysyt läheisiltä, luet sopimuksen tai vertailet tarjouksia.",
    },
    re: [
      /\b(no need to (think|read|check|ask)|don'?t (need to )?(tell|ask|check with)|between (you and me|us)|keep (this|it) (quiet|between us)|you don'?t have to read)\b/i,
      /(ei tarvitse (miettiä|lukea|kysyä|tarkistaa)|ei kannata kertoa|jää meidän välille|pidetään tämä meidän välisenä|älä kysy)/i,
    ],
  },
  {
    id: "payment",
    severity: "high",
    weight: 35,
    label: { en: "Risky payment method", fi: "Riskialtis maksutapa" },
    tip: { en: "Unsafe payment request. Stop.", fi: "Vaarallinen maksupyyntö. Pysähdy." },
    why: {
      en: "Gift cards, crypto, cash-only, up-front deposits and requests for bank codes are hallmarks of fraud and hard to recover.",
      fi: "Lahjakortit, krypto, pelkkä käteinen, ennakkomaksut ja pankkitunnusten kysely ovat huijausten tunnusmerkkejä, eikä rahoja saa takaisin.",
    },
    re: [
      /\b(gift ?cards?|wire transfer|crypto(currency)?|bitcoin|cash only|western union|pay (it )?up ?front|deposit (now|today)|your (bank|online banking) (details|codes|password)|pin code)\b/i,
      /(lahjakort|vain käteinen|käteisellä heti|kryptovaluut|bitcoin|maksa etukäteen|ennakkomaksu (nyt|tänään)|pankkitunnu|tunnusluvu|verkkopankkitunnu)/i,
    ],
  },
  {
    id: "too_good",
    severity: "high",
    weight: 28,
    label: { en: "Too good to be true", fi: "Liian hyvää ollakseen totta" },
    tip: { en: "Guaranteed returns? Be careful.", fi: "Taattu tuotto? Ole varovainen." },
    why: {
      en: "Guaranteed profits or zero-risk promises are not something legitimate sellers can make.",
      fi: "Taattuja voittoja tai riskittömyyttä ei asiallinen myyjä voi luvata.",
    },
    re: [
      /\b(guaranteed (return|profit|income|savings)|risk[- ]free|can'?t lose|100 ?% (safe|guaranteed)|double your money|pays for itself (immediately|in no time))\b/i,
      /(taattu (tuotto|voitto|säästö)|riskitön|et voi hävitä|varma voitto|tuplaat rahasi|maksaa itsensä takaisin heti)/i,
    ],
  },
  {
    id: "fine_print",
    severity: "medium",
    weight: 16,
    label: { en: "Brushing off the contract", fi: "Sopimuksen vähättely" },
    tip: { en: "Read the contract first.", fi: "Lue sopimus ensin." },
    why: {
      en: "Downplaying the terms usually means the terms matter: fees, lock-in or automatic renewal.",
      fi: "Ehtojen vähättely tarkoittaa yleensä, että ehdoilla on väliä: kuluja, sitoutumista tai automaattista jatkumista.",
    },
    re: [
      /\b(don'?t worry about (the )?(fine print|contract|details|terms)|just (a|the) (formality|standard paperwork)|standard contract, nothing special)\b/i,
      /(pienellä präntätty|älä välitä (sopimuksesta|ehdoista)|pelkkä muodollisuus|ihan vakiosopimus|ei siinä mitään erikoista)/i,
    ],
  },
  {
    id: "lock_in",
    severity: "medium",
    weight: 14,
    label: { en: "Lock-in or no cancellation", fi: "Sitoutuminen tai perumisen esto" },
    tip: { en: "Check cancellation terms.", fi: "Tarkista perumisehdot." },
    why: {
      en: "Long commitments, auto-renewal or claims that you can't cancel deserve a close look.",
      fi: "Pitkät sitoumukset, automaattinen jatkuminen tai väite, ettei voi perua, kannattaa tarkistaa huolella.",
    },
    re: [
      /\b(no cancell?ation|non[- ]refundable|can'?t cancel|(\d+|twelve|eighteen|twenty[- ]four|thirty[- ]six|forty[- ]eight|sixty|two|three|five)[- ](month|year) (contract|commitment)|automatically renews?)\b/i,
      /(ei voi perua|ei palautusoikeutta|ei peruutusoikeutta|määräaikai|sitoutumi|jatkuu automaattisesti|\d+ kuukauden sopimus)/i,
    ],
  },
  {
    id: "social_proof",
    severity: "low",
    weight: 8,
    label: { en: "Unverifiable social proof", fi: "Tarkistamaton sosiaalinen paine" },
    tip: { en: "Others bought? Doesn't matter.", fi: "Muut ostivat? Ei merkitse." },
    why: {
      en: "Claims that neighbours or officials endorse it are easy to say and hard to check.",
      fi: "Väitteet naapureiden tai viranomaisten suosituksesta on helppo sanoa ja vaikea tarkistaa.",
    },
    re: [
      /\b(everyone (is buying|has (one|it))|your neighbou?rs (already|have|signed)|approved by the (government|city|authorities))\b/i,
      /(kaikki naapurit|kaikki ovat (ostaneet|ottaneet)|viranomaisten hyväksymä|kaupungin puolesta|valtion tukema)/i,
    ],
  },
  {
    id: "free_hook",
    severity: "low",
    weight: 6,
    label: { en: "'Free' hook", fi: "Ilmaiseksi-koukku" },
    tip: { en: "'Free' usually has a catch.", fi: "'Ilmainen' sisältää usein koukun." },
    why: {
      en: "A free gift or free trial often hides a paid commitment.",
      fi: "Ilmainen lahja tai kokeilu kätkee usein maksullisen sitoumuksen.",
    },
    re: [
      /\b(free gift|completely free|no cost to you|free trial)\b/i,
      /(ilmainen lahja|kaupan päälle|ei maksa (sinulle )?mitään|ilmainen kokeilu)/i,
    ],
  },
];

export interface LocalHit {
  patternId: string;
  label: string;
  tip: string;
  why: string;
  severity: Severity;
  quote: string;
}

export function detectFlags(text: string, lang: Lang): LocalHit[] {
  const hits: LocalHit[] = [];
  for (const p of PATTERNS) {
    for (const re of p.re) {
      const m = re.exec(text);
      if (m) {
        hits.push({
          patternId: p.id,
          label: p.label[lang],
          tip: p.tip[lang],
          why: p.why[lang],
          severity: p.severity,
          quote: excerpt(text, m.index, m[0].length),
        });
        break;
      }
    }
  }
  return hits;
}

function excerpt(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + len + 40);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

const T = {
  en: {
    go: "Looks fair, but double-check",
    caution: "Don't sign today",
    walk_away: "Walk away",
    spokenGo: "Preliminary check: I didn't hear obvious pressure tactics. Still compare prices before you commit.",
    spokenCaution: (n: number) =>
      `Preliminary check: I noticed ${n} warning ${n === 1 ? "sign" : "signs"}. Don't sign today. Take the offer home and compare.`,
    spokenWalk: "Preliminary check: this sounds like a high-risk pitch. I'd walk away and don't pay anything now.",
    short: "The conversation was very short, so this check is uncertain.",
    q: [
      "Can I get the full offer and contract in writing to read at home?",
      "What is the total cost including all fees over the whole contract?",
      "How do I cancel, and is there a withdrawal period?",
      "Can you give me your company name and business ID so I can look you up?",
    ],
    steps: [
      "Ask for the offer in writing and take at least a day to think.",
      "Compare with at least two other providers.",
      "Never pay up front or share bank codes during a sales visit.",
    ],
    rights:
      "In the EU, contracts made away from business premises (door-to-door, street, home visits) usually come with a 14-day withdrawal right. Check the terms.",
    notice: "AI analysis unavailable. This is an on-device preliminary check based on known pressure tactics.",
  },
  fi: {
    go: "Vaikuttaa asialliselta, mutta tarkista",
    caution: "Älä allekirjoita tänään",
    walk_away: "Kävele pois",
    spokenGo: "Alustava tarkistus: en kuullut selviä painostuskeinoja. Vertaa silti hintoja ennen sitoutumista.",
    spokenCaution: (n: number) =>
      `Alustava tarkistus: huomasin ${n} varoitusmerkki${n === 1 ? "n" : "ä"}. Älä allekirjoita tänään. Ota tarjous kotiin ja vertaile.`,
    spokenWalk: "Alustava tarkistus: tämä kuulostaa riskialttiilta. Kävelisin pois, äläkä maksa mitään nyt.",
    short: "Keskustelu oli hyvin lyhyt, joten arvio on epävarma.",
    q: [
      "Saanko koko tarjouksen ja sopimuksen kirjallisena kotiin luettavaksi?",
      "Mikä on kokonaishinta kaikkine kuluineen koko sopimuskaudelta?",
      "Miten sopimuksen voi perua, ja onko peruutusaikaa?",
      "Mikä on yrityksenne nimi ja Y-tunnus, jotta voin tarkistaa teidät?",
    ],
    steps: [
      "Pyydä tarjous kirjallisena ja mieti vähintään vuorokausi.",
      "Vertaa vähintään kahteen muuhun tarjoajaan.",
      "Älä koskaan maksa etukäteen tai anna pankkitunnuksia myyntikäynnillä.",
    ],
    rights:
      "EU:ssa liiketilojen ulkopuolella tehdyissä sopimuksissa (kotimyynti, katumyynti) on yleensä 14 päivän peruutusoikeus. Tarkista ehdot.",
    notice: "Tekoälyanalyysi ei ole saatavilla. Tämä on laitteella tehty alustava tarkistus tunnettujen painostuskeinojen perusteella.",
  },
};

export function heuristicAnalysis(req: AnalyzeRequest): Analysis {
  const lang = req.lang;
  const t = T[lang];
  const fullText = req.transcript.map((s) => s.text).join(" ");
  const hits = detectFlags(fullText, lang);
  const byId = new Map(PATTERNS.map((p) => [p.id, p]));

  let risk = hits.reduce((sum, h) => sum + (byId.get(h.patternId)?.weight ?? 0), 0);
  risk += Math.min(15, req.marks.length * 5); // buyer's own discomfort taps
  risk = Math.min(100, risk);

  const highCount = hits.filter((h) => h.severity === "high").length;
  let verdict: Verdict = "go";
  if (risk >= 55 || hits.some((h) => h.patternId === "payment")) verdict = "walk_away";
  else if (risk >= 15 || highCount > 0) verdict = "caution";

  const words = fullText.split(/\s+/).filter(Boolean).length;
  const tooShort = words < 40;

  const red_flags: RedFlag[] = hits.map((h) => ({
    tactic: h.label,
    quote: h.quote,
    why: h.why,
    severity: h.severity,
  }));

  const spoken =
    verdict === "walk_away" ? t.spokenWalk : verdict === "caution" ? t.spokenCaution(hits.length) : t.spokenGo;

  const offPremises = /door|street|home|ovi|koti|katu/i.test(`${req.context.category} ${req.context.notes}`);

  return {
    verdict,
    headline: t[verdict],
    spoken_summary: tooShort ? `${spoken} ${t.short}` : spoken,
    deal_score: Math.max(5, 70 - risk),
    scam_risk: risk,
    confidence: tooShort ? "low" : "medium",
    red_flags,
    green_flags: [],
    claims_to_verify: [],
    questions_to_ask: t.q,
    next_steps: t.steps,
    consumer_rights_note: offPremises || verdict !== "go" ? t.rights : "",
    source: "heuristic",
    notice: t.notice,
  };
}
