// Welke artikels stonden er op de homepage op het moment van de opname?
//
// Naast elke desktopscreenshot `hln_<tijd>.webp` komt een klein bestand
// `hln_<tijd>.titels.json` met de artikellinks die op dat moment op de pagina
// stonden: URL, titel en plek op de pagina. De pagina is dan al volledig
// geladen (consent weg, gescrold, lazy-loading gedaan), dus beeld en titels
// horen gegarandeerd bij hetzelfde moment.
//
// Dit is een extraatje bij de opname, geen voorwaarde: lukt het uitlezen niet
// of duurt het te lang, dan is er gewoon geen titelbestand en blijft de
// screenshot staan. Vandaar de harde grenzen hieronder — op tijd, aantal links
// en lengte — zodat een rommelige homepage een run nooit zwaarder maakt.

export const TITELS_SUFFIX = '.titels.json';

// Versie van het bestandsformaat; verhogen bij een breuk, zodat een lezer
// oude en nieuwe bestanden uit elkaar kan houden.
const FORMAAT = 1;

const GRENZEN = {
  // Na deze tijd geven we op; de opname gaat gewoon door
  timeoutMs: 5000,
  // Meer links dan dit bewaren we niet (in DOM-volgorde, dus de bovenkant gaat voor)
  maxLinks: 400,
  // Hoeveel <a>-elementen we hooguit bekijken (sommige homepages hebben er duizenden)
  maxAnkers: 4000,
  maxTitel: 300,
  // Korter dan dit, of minder dan drie woorden, is navigatie ("Sport", "Meer nieuws")
  minTitel: 15,
  minWoorden: 3,
};

// Draait in de browser (page.evaluate): geen verwijzingen naar iets buiten deze functie.
function titelsUitPagina(opties) {
  const { maxLinks, maxAnkers, maxTitel, minTitel, minWoorden, patroon } = opties;
  const artikelPatroon = patroon ? new RegExp(patroon) : null;

  // Het "basisdomein": de laatste twee labels (hln.be, vrt.be, nos.nl). Links naar
  // een ander domein (adverteerders, zustermerken, sociale media) tellen niet.
  const basis = (host) => host.replace(/^www\./, '').split('.').slice(-2).join('.');
  const eigenDomein = basis(location.hostname);
  const startpad = location.pathname.replace(/\/+$/, '');

  // Zachte afbrekingstekens (HLN zet die in lange woorden) eruit, witruimte samen
  const schoon = (s) => (s || '').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();

  // Menu's, kop en voet van de site: daar staan rubrieken, geen artikels
  const KADER = 'nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [role="menu"]';

  // Volgparameters weg, zodat dezelfde link op twee plekken dezelfde URL heeft
  // en later te koppelen is aan de URL uit de RSS-feed.
  function normaliseer(href) {
    let u;
    try { u = new URL(href, location.href); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|at_|xtor$|ref$|referrer$|source$|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    }
    return u;
  }

  // De titel van een teaser: een kop in de link wint (dan valt het labeltje
  // "Premium" of de tijdsaanduiding weg), anders de tekst, anders het aria-label.
  function titelVan(a) {
    const kop = a.querySelector('h1, h2, h3, h4, h5, h6, [class*="title" i], [class*="titel" i], [class*="headline" i]');
    const tekst = schoon(kop?.innerText) || schoon(a.innerText) || schoon(a.getAttribute('aria-label')) || schoon(a.title);
    return tekst.length > maxTitel ? tekst.slice(0, maxTitel) : tekst;
  }

  const ankers = document.querySelectorAll('a[href]');
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const gezien = new Set();
  const artikels = [];

  for (let i = 0; i < ankers.length && i < maxAnkers && artikels.length < maxLinks; i++) {
    const a = ankers[i];
    const u = normaliseer(a.getAttribute('href'));
    if (!u || basis(u.hostname) !== eigenDomein) continue;
    if (u.pathname.replace(/\/+$/, '') === startpad && !u.search) continue;
    const url = u.toString();
    if (artikelPatroon && !artikelPatroon.test(url)) continue;

    if (a.closest(KADER)) continue;

    // Niet zichtbaar, of buiten de pagina (een ingeklapt menu staat vaak boven of links ervan)
    const r = a.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.top + scrollY < 0 || r.left + scrollX < 0) continue;
    if (a.checkVisibility && !a.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;

    const titel = titelVan(a);
    if (titel.length < minTitel || titel.split(' ').length < minWoorden) continue;

    // Dezelfde link mag twee keer (groot bovenaan én in een lijstje), maar niet
    // twee keer dezelfde link met dezelfde titel op dezelfde plek.
    const sleutel = url + '\u0000' + titel;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);

    artikels.push({
      u: url,
      t: titel,
      // Plek op de pagina in CSS-pixels van de desktopviewport, vanaf linksboven
      x: Math.round(r.left + scrollX),
      y: Math.round(r.top + scrollY),
      b: Math.round(r.width),
      h: Math.round(r.height),
    });
  }

  return { url: location.href, artikels };
}

// Leest de titels uit een geladen pagina. Geeft null terug (en logt) als het
// niet lukt of te lang duurt — nooit een fout, want de opname gaat voor.
export async function leesTitels(page, website) {
  const { name } = website;
  let timer;
  try {
    const opties = { ...GRENZEN, patroon: website.artikelPatroon || null };
    const resultaat = await Promise.race([
      page.evaluate(titelsUitPagina, opties),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`uitlezen duurde langer dan ${GRENZEN.timeoutMs} ms`)), GRENZEN.timeoutMs);
      }),
    ]);
    if (!resultaat || !Array.isArray(resultaat.artikels)) return null;
    return resultaat;
  } catch (error) {
    console.log(`⚠️  ${name}: titels uitlezen mislukt — ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Het bestand naast de screenshot. `schaal` zet de paginacoördinaten om naar
// pixels in de bewaarde webp (die is van 1366 naar 960 breed verkleind);
// `hoogte` is hoe ver de webp reikt, in paginapixels — wat lager staat, staat
// wel op de homepage maar niet op het beeld.
export function titelsBestand(website, timestamp, gelezen, { breedte, hoogte, schaal }) {
  return {
    v: FORMAAT,
    site: website.name,
    tijd: timestamp,
    url: gelezen.url,
    breedte,
    hoogte,
    schaal,
    artikels: gelezen.artikels,
  };
}
