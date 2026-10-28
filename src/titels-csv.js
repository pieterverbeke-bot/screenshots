// De titelbestanden (`*.titels.json`, zie titels.js) als CSV: één rij per artikel
// per opname. Gedeeld door export-titels.js (de download via GitHub Actions) en
// upload-to-r2.js, dat per run één CSV in de bucket zet onder `titels/<datum>/`.
// Die laatste leest de Nieuwsmonitor (`src/titels-download.ts` in de repo
// `nieuwsmonitor`): hij plakt de runbestanden van een dag aan elkaar, met de
// kopregel van het eerste bestand. Wijzigen de kolommen, dan verandert dus ook
// wat daar te downloaden valt — de kopregel reist mee, de volgorde dus ook.
//
// `;` als scheidingsteken: zo opent Excel met Belgische of Nederlandse
// instellingen het bestand met dubbelklikken.

// Map in de bucket voor de CSV's per run: titels/<YYYY-MM-DD>/run_<tijd>.csv
export const TITELS_MAP = 'titels';

export const KOLOMMEN = ['site', 'merk', 'datum', 'tijd', 'positie', 'titel', 'url', 'x', 'y', 'breedte', 'hoogte', 'op_beeld'];

// Een veld voor CSV: aanhalingstekens waar nodig, en een titel die met = + - @
// begint krijgt een ' ervoor, zodat Excel er geen formule van maakt.
function csvVeld(waarde) {
  let s = waarde == null ? '' : String(waarde);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// De rijen van één titelbestand. `positie` is de volgorde op het scherm (van boven
// naar onder, dan van links naar rechts), niet de volgorde in de HTML.
export function rijenUitTitels(data, merk) {
  const [datum, klok = ''] = String(data.tijd || '').split('T');
  const tijd = klok.slice(0, 5).replace('-', ':');
  const artikels = [...(data.artikels || [])].sort((a, b) => a.y - b.y || a.x - b.x);
  return artikels.map((a, i) => [
    data.site, merk || data.site, datum, tijd, i + 1, a.t, a.u, a.x, a.y, a.b, a.h,
    data.hoogte == null || a.y < data.hoogte ? 'ja' : 'nee',
  ]);
}

// Kopregel plus rijen. Met `bom` een BOM vooraan, zodat Excel de accenten goed leest;
// zonder voor de runbestanden, die de Nieuwsmonitor nog aan elkaar plakt.
export function csvTekst(rijen, { bom = true } = {}) {
  return (bom ? '\ufeff' : '') + [KOLOMMEN, ...rijen].map(r => r.map(csvVeld).join(';')).join('\r\n') + '\r\n';
}
