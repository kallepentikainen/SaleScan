/**
 * Scripted conversations for demos in noisy hackathon halls, or on devices
 * without speech recognition. Lines go through the same pipeline as live
 * speech: transcript, on-device alerts, live check, final analysis.
 */
import type { Lang, SessionContext } from "../../shared/types.ts";

export interface DemoScript {
  context: SessionContext;
  lines: string[];
}

export const DEMOS: Record<Lang, DemoScript> = {
  en: {
    context: {
      category: "Door-to-door sale",
      item: "Fixed-price electricity contract with solar panel package",
      price: "€89/month",
      budget: "Around €60/month for electricity",
      notes: "Seller knocked on my door unannounced.",
    },
    lines: [
      "Hi! I'm from the energy savings program here in your neighbourhood, we're helping households cut their bills.",
      "Can I ask what you pay for electricity right now? Around sixty euros a month? Okay.",
      "So with our package you get a fixed price plus solar panels on the roof, and it's guaranteed savings of at least forty percent.",
      "Honestly it pays for itself in no time. Your neighbours have already signed, almost the whole street.",
      "The monthly fee is eighty-nine euros, but the panels are basically free, that's included.",
      "This offer is only valid today, the price goes up tomorrow because the subsidy runs out.",
      "Don't worry about the fine print, it's a standard contract, nothing special.",
      "It's a sixty month commitment but that's normal in this industry.",
      "If you sign now I can also give you a free gift, a smart thermostat.",
      "We just need a small deposit today, two hundred euros, I can take it by card or cash.",
      "You don't need to ask anyone, honestly, I can see you're a smart person who can decide yourself.",
      "So shall we just sign here and get you started?",
    ],
  },
  fi: {
    context: {
      category: "Kotimyynti",
      item: "Kiinteähintainen sähkösopimus ja aurinkopaneelipaketti",
      price: "89 €/kk",
      budget: "Noin 60 €/kk sähköön",
      notes: "Myyjä tuli ovelle ilmoittamatta.",
    },
    lines: [
      "Moi! Olen täältä alueen energiansäästöohjelmasta, autamme kotitalouksia pienentämään laskuja.",
      "Saanko kysyä, paljonko maksat sähköstä nyt? Noin kuusikymmentä euroa kuussa? Selvä.",
      "Meidän paketissa saat kiinteän hinnan ja aurinkopaneelit katolle, ja siinä on taattu säästö vähintään neljäkymmentä prosenttia.",
      "Rehellisesti se maksaa itsensä takaisin heti. Kaikki naapurit ovat jo ottaneet tämän, melkein koko katu.",
      "Kuukausimaksu on kahdeksankymmentäyhdeksän euroa, mutta paneelit tulevat käytännössä kaupan päälle.",
      "Tämä tarjous on voimassa vain tänään, huomenna hinta nousee koska tuki loppuu.",
      "Älä välitä sopimuksesta, se on ihan vakiosopimus, ei siinä mitään erikoista.",
      "Siinä on kuudenkymmenen kuukauden sitoutuminen mutta se on alalla normaalia.",
      "Jos allekirjoitat nyt, saat myös ilmaisen lahjan, älytermostaatin.",
      "Tarvitaan vain pieni ennakkomaksu nyt, kaksisataa euroa, käy kortilla tai käteisellä.",
      "Ei tarvitse kysyä keneltäkään, näen että olet fiksu ihminen joka osaa päättää itse.",
      "Eli laitetaanko nimi tähän niin päästään alkuun?",
    ],
  },
};
