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
  // Lengte van een bloknaam of een ander attribuut van de site
  maxBlok: 120,
  // Een blokkop is kort; wat langer is, is de kop van een artikel
  maxKop: 60,
};

// Draait in de browser (page.evaluate): geen verwijzingen naar iets buiten deze functie.
function titelsUitPagina(opties) {
  const { maxLinks, maxAnkers, maxTitel, minTitel, minWoorden, maxBlok, maxKop, patroon } = opties;
  const artikelPatroon = patroon ? new RegExp(patroon) : null;

  // Het "basisdomein": de laatste twee labels (hln.be, vrt.be, nos.nl). Links naar
  // een ander domein (adverteerders, zustermerken, sociale media) tellen niet.
  const basis = (host) => host.replace(/^www\./, '').split('.').slice(-2).join('.');
  const eigenDomein = basis(location.hostname);
  const startpad = location.pathname.replace(/\/+$/, '');

  // Zachte afbrekingstekens (HLN zet die in lange woorden) eruit, witruimte samen
  const schoon = (s) => (s || '').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();

  // Menu's, kop en voet van de site: daar staan rubrieken, geen artikels
  const KADER = 'nav, [role="navigation"], [role="banner"], [role="contentinfo"], [role="menu"]';
  // Een <header> of <footer> binnen een <article> is van de teaser, niet van de
  // site: NRC zet daar zijn koppen in.
  const inKader = (a) => {
    if (a.closest(KADER)) return true;
    const kopVoet = a.closest('header, footer');
    return Boolean(kopVoet && !kopVoet.closest('article'));
  };

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

  // Een attribuut als tekst. NU.nl schrijft soms letterlijk "undefined" in data-list.
  function attr(el, naam) {
    const w = schoon(el?.getAttribute(naam));
    return w && !/^(undefined|null)$/i.test(w) ? w.slice(0, maxBlok) : '';
  }

  // Het eerste attribuut met een waarde op het dichtstbijzijnde element dat het heeft
  function eersteAttr(a, namen) {
    for (const naam of namen) {
      const w = attr(a.closest(`[${naam}]`), naam);
      if (w) return w;
    }
    return '';
  }

  // NOS: data-tracking="nestId1=frontpage-sport|nestPos1=5"
  function spoor(el) {
    const uit = {};
    for (const deel of (el?.getAttribute('data-tracking') || '').split('|')) {
      const i = deel.indexOf('=');
      if (i > 0) uit[deel.slice(0, i)] = deel.slice(i + 1);
    }
    return uit;
  }

  // De naam die de site een sectie geeft. Per element bewaard, want een blok telt
  // tientallen links.
  const namen = new Map();
  function naamVan(e) {
    if (namen.has(e)) return namen.get(e);
    const verwijzing = e.getAttribute('aria-labelledby');
    const naam = (verwijzing && schoon(document.getElementById(verwijzing.split(' ')[0])?.innerText)) || attr(e, 'aria-label');
    namen.set(e, naam);
    return naam;
  }

  // De korte koppen in een sectie die niet bij een artikel horen
  const koppen = new Map();
  function koppenVan(e) {
    if (!koppen.has(e)) {
      koppen.set(e, [...e.querySelectorAll('h1, h2, h3, h4')]
        .filter(h => !h.closest('article'))
        // "Sportmeer", "Sport meer": de kop van Mediahuis met zijn link erin
        .map(h => ({ h, tekst: schoon(h.innerText).replace(/\s*meer$/i, '') }))
        .filter(k => k.tekst && k.tekst.length <= maxKop));
    }
    return koppen.get(e);
  }

  // Het opschrift boven deze link: de sectie die er het dichtst omheen zit en een
  // naam heeft, of de laatste kop die in zo'n sectie vóór de link staat. Niet de
  // eerste kop: één sectie telt op NU.nl en RTL meerdere blokken onder elkaar.
  function labelVan(a) {
    for (let e = a.parentElement; e && e !== document.body; e = e.parentElement) {
      if (!e.matches('section, aside, [role="region"][aria-label]')) continue;
      const naam = naamVan(e);
      if (naam) return naam;
      if (!e.matches('section, aside')) continue;
      let laatste = '';
      for (const { h, tekst } of koppenVan(e)) {
        if (h.contains(a)) continue;
        if (h.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) laatste = tekst;
        else break;
      }
      if (laatste) return laatste;
    }
    return '';
  }

  // Een sectie zonder enige naam (de hoofdblokken van VRT en Linda) krijgt haar
  // volgnummer op de pagina: dan blijven die teasers tenminste bij elkaar.
  let secties = null;
  function sectieNummer(a) {
    const sectie = a.closest('section');
    if (!sectie) return '';
    secties ??= [...document.querySelectorAll('section')];
    return `sectie-${secties.indexOf(sectie) + 1}`;
  }

  // In welk blok staat deze link? Elke uitgeverij schrijft dat anders op; de
  // eerste regel die iets vindt, wint. `bron` zegt welke, zodat een analyse een
  // bloknaam van de site kan scheiden van wat we zelf afleidden uit een kop.
  function blokVan(a) {
    // DPG: <a data-list data-position> (HLN, AD, NU, indebuurt, Libelle) of
    // <div data-list data-position><a> (De Morgen, de Volkskrant, Trouw, Parool)
    const lijst = a.closest('[data-list]');
    const lijstNaam = attr(lijst, 'data-list');
    if (lijstNaam) {
      // data-gtm="sixpack/item 2": het soort blok. "teaser_click" zegt niets, en
      // HLN_SITE_HOME_DOSSIER_2 herhaalt alleen de lijst.
      const gtm = attr(lijst, 'data-gtm');
      const soort = gtm.includes('/item') ? gtm.split('/')[0] : '';
      return {
        naam: lijstNaam,
        bron: 'data-list',
        type: (soort.toLowerCase() !== lijstNaam.toLowerCase() ? soort : '')
          || attr(a.closest('[data-block-type]'), 'data-block-type') || attr(a.closest('[data-block]'), 'data-block'),
      };
    }
    // NOS
    const nos = spoor(a.closest('[data-tracking*="nestId1="]'));
    if (nos.nestId1) return { naam: nos.nestId1, bron: 'data-tracking', type: nos.nestType1 || '' };
    // NRC: een zijkolom (data-aside-action) binnen een blok (data-block-*)
    const nrc = a.closest('[data-aside-action], [data-block-id]');
    if (nrc) {
      const zij = attr(nrc, 'data-aside-action');
      return {
        naam: zij || attr(nrc, 'data-block-role') || attr(nrc, 'data-block-label') || attr(nrc, 'data-block-id'),
        bron: zij ? 'data-aside-action' : 'data-block',
        type: attr(a.closest('[data-shape]'), 'data-shape'),
      };
    }
    // Sporza
    const sporza = attr(a.closest('[analyticsid]'), 'analyticsid');
    if (sporza) return { naam: sporza, bron: 'analyticsid', type: '' };
    // Mediahuis: <section id="frontpage-news-Sport" data-testid="storyblock-type-RegularGroup">
    const verhaal = a.closest('section[id][data-testid^="storyblock"]');
    if (verhaal) {
      return { naam: attr(verhaal, 'id'), bron: 'section-id', type: attr(verhaal, 'data-testid').replace(/^storyblock-type-/, '') };
    }
    // RTL
    const rtl = attr(a.closest('[data-block-type]'), 'data-block-type');
    if (rtl) return { naam: rtl, bron: 'data-block-type', type: rtl };
    // Geen merkteken van de site (VRT, Linda): de naam van de sectie
    const label = labelVan(a);
    if (label) return { naam: label, bron: 'kop', type: '' };
    const nummer = sectieNummer(a);
    return { naam: nummer, bron: nummer ? 'sectie-nummer' : '', type: '' };
  }

  // De plek in het blok zoals de site die zelf nummert, als ze dat doet
  function plekVan(a) {
    const w = eersteAttr(a, ['data-position', 'data-item-position']) || spoor(a).elementPos || '';
    return /^\d+$/.test(w) ? Number(w) : null;
  }

  function idVan(a) {
    return eersteAttr(a, ['data-content_id', 'data-content-id', 'data-article_id', 'data-article-id']) || spoor(a).elementId || '';
  }

  // Alleen op de teaser zelf: hogerop in de pagina staat data-type ook voor iets anders
  function soortVan(a) {
    const teaser = a.closest('[data-list]') || a;
    return attr(teaser, 'data-teaser-type') || attr(teaser, 'data-teaser_type') || attr(teaser, 'data-type')
      || attr(a.closest('[data-article-type]'), 'data-article-type') || spoor(a).elementType || '';
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

    if (inKader(a)) continue;

    // Niet zichtbaar, of buiten de pagina (een ingeklapt menu staat vaak boven of links ervan)
    const r = a.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.top + scrollY < 0 || r.left + scrollX < 0) continue;
    if (a.checkVisibility && !a.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;

    const titel = titelVan(a);
    if (titel.length < minTitel || titel.split(' ').length < minWoorden) continue;

    // Dezelfde link mag twee keer (groot bovenaan én in een lijstje), maar niet
    // twee keer dezelfde link met dezelfde titel in hetzelfde blok (foto en kop
    // van één teaser zijn vaak twee links).
    const blok = blokVan(a);
    const sleutel = url + '\u0000' + titel + '\u0000' + blok.naam;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);

    const artikel = {
      u: url,
      t: titel,
      // Plek op de pagina in CSS-pixels van de desktopviewport, vanaf linksboven
      x: Math.round(r.left + scrollX),
      y: Math.round(r.top + scrollY),
      b: Math.round(r.width),
      h: Math.round(r.height),
    };
    // Enkel wat er is, want een opname telt tot 400 artikels (formaat: README)
    const extra = { bk: blok.naam, br: blok.bron, bt: blok.type, bl: labelVan(a), ip: plekVan(a), ci: idVan(a), ty: soortVan(a) };
    for (const [k, w] of Object.entries(extra)) if (w !== '' && w !== null) artikel[k] = w;
    artikels.push(artikel);
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
