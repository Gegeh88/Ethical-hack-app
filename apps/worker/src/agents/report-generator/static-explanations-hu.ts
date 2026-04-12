/**
 * Static Hungarian-language explanations for common medium/low/info findings.
 *
 * These are used as fallback when AI enrichment is not applied
 * (only high/critical findings get AI enrichment to control cost).
 *
 * Keyed by template_id from the passive scanner checks.
 */
export interface StaticExplanation {
  mi_ez: string;
  miert_veszelyes: string;
  javitas: string[];
}

export const STATIC_EXPLANATIONS_HU: Record<string, StaticExplanation> = {
  'headers.missing_csp': {
    mi_ez: 'A Content-Security-Policy (CSP) egy HTTP header, ami megmondja a bongeszonek, milyen forrasokbol tolthet be tartalmat. Ennek hianyaban a bongeszo barmit betolt.',
    miert_veszelyes: 'CSP hianyaban egy tamado XSS sebezhetoseg reven konnyebben tud kartekony JavaScriptet injektalni, ami ellop jelszavakat vagy cookie-kat.',
    javitas: [
      'Adj hozza CSP header-t a webszerver konfiguraciojaban',
      'Teszteld eloszor Report-Only modban',
      'Finomitsd a szabalyt a szukseges kulso forrasok hozzaadasaval',
    ],
  },
  'headers.missing_hsts': {
    mi_ez: 'A HTTP Strict Transport Security (HSTS) header hianya azt jelenti, hogy a bongeszo nem koveteli meg a HTTPS hasznalatat.',
    miert_veszelyes: 'HSTS nelkul a felhasznalokat at lehet iranyitani HTTP-re, ahol a forgalom lehallgathato (man-in-the-middle tamadas).',
    javitas: [
      'Adj hozza Strict-Transport-Security header-t (pl. max-age=31536000; includeSubDomains)',
      'Gyozodj meg rola, hogy az oldal teljesen HTTPS-en mukodik eloszor',
      'Fontold meg a HSTS preload listahoz valo csatlakozast',
    ],
  },
  'headers.missing_x_frame_options': {
    mi_ez: 'Az X-Frame-Options header hianya lehetove teszi, hogy az oldalt masik oldalba agyazzak iframe-kent.',
    miert_veszelyes: 'Clickjacking tamadast tesz lehetove: a tamado a sajat oldalaba agyazza az Onot, es a felhasznalo tudtan kivul kattint.',
    javitas: [
      'Allitsd be az X-Frame-Options header-t DENY vagy SAMEORIGIN ertekre',
      'Alternativakent hasznalj CSP frame-ancestors direktivat',
    ],
  },
  'headers.missing_x_content_type_options': {
    mi_ez: 'Az X-Content-Type-Options: nosniff header hianya megengedi a bongeszoknek, hogy sajat maguk probaljak kitalalni a fajlok tipusat.',
    miert_veszelyes: 'MIME-type sniffing reven egy artalmatlannak tuno fajl (pl. kep) JavaScriptkent futhat le.',
    javitas: [
      'Adj hozza X-Content-Type-Options: nosniff header-t minden valaszhoz',
    ],
  },
  'headers.server_disclosure': {
    mi_ez: 'A Server header felfedte a webszerver tipusat es/vagy verziojat.',
    miert_veszelyes: 'A verzioinformacio segit a tamadoknak celzott exploitokat keresni az adott szerver verziohoz.',
    javitas: [
      'Allitsd be a webszervert, hogy ne fedje fel a verzioszamot',
      'Apache: ServerTokens Prod, Nginx: server_tokens off',
    ],
  },
  'dns.no_spf': {
    mi_ez: 'Nincs SPF (Sender Policy Framework) rekord a domainhez. Az SPF megmondja, mely szerverek kuldhetnek emailt a domain neven.',
    miert_veszelyes: 'SPF nelkul barki kuldhet emailt a domain neven (email spoofing), ami adathalaszathoz es hirnev-serteleshez vezet.',
    javitas: [
      'Hozz letre egy TXT rekordot a DNS-ben SPF szaballyal',
      'Pelda: v=spf1 include:_spf.google.com ~all',
      'Teszteld az SPF rekordot online eszkozkkel (pl. mxtoolbox.com)',
    ],
  },
  'dns.no_dmarc': {
    mi_ez: 'Nincs DMARC rekord a domainhez. A DMARC szabalyozza, mi tortenjen az SPF/DKIM-et nem teljesito emailekkel.',
    miert_veszelyes: 'DMARC nelkul az email szolgaltatok nem tudjak hatekekonyan szurni a hamis emaileket, igy a felhasznalok adathalasz leveleket kaphatnak a domain neven.',
    javitas: [
      'Hozz letre egy _dmarc TXT rekordot (pl. v=DMARC1; p=quarantine; rua=mailto:dmarc@domain.hu)',
      'Kezdd "p=none" modban es figyeld a jelnteseket',
      'Fokozatosan emelj "p=quarantine" majd "p=reject" szintre',
    ],
  },
  'ssl.expiring_soon': {
    mi_ez: 'Az SSL/TLS tanusitvany hamarosan lejar. A bongeszo figyelmeztetni fogja a latogatokat, ha lejar.',
    miert_veszelyes: 'Lejart tanusitvany eseten a felhasznalok biztonsagi figyelmeztetest latnak, ami elvesziti a bizalmat es csokkenti a forgalmat.',
    javitas: [
      'Ujitsd meg az SSL tanusitvanyt a lejarat elott',
      'Fontold meg az automatikus megujitast (pl. Let\'s Encrypt + certbot)',
      'Allits be monitoringot a tanusitvany lejaratara',
    ],
  },
  'ssl.weak_cipher': {
    mi_ez: 'A szerver gyenge titkositasi algoritmust (cipher suite-ot) tamogat.',
    miert_veszelyes: 'A gyenge titkositas lehallgathato vagy feltorheto, ami az erzekeny adatok (jelszavak, bankkartya) kiszivarasgahoz vezethet.',
    javitas: [
      'Tiltsd le a gyenge cipher suite-okat a szerver konfiguraciojaban',
      'Hasznalj modern TLS 1.2/1.3 konfigraciot',
      'Teszteld a Mozilla SSL Configuration Generator-ral',
    ],
  },
  'robots.sensitive_paths': {
    mi_ez: 'A robots.txt fajl erzekeny utvonalakat fed fel (pl. admin panelek, config fajlok).',
    miert_veszelyes: 'Bar a robots.txt arra valo, hogy a keresomotoroktol elrejtse az oldalakat, a tamadok pont ezeket keresik, mert erzekeny teruletekre mutathatnak.',
    javitas: [
      'Ne hasznald a robots.txt-t biztonsagi eszkoezkent — az barkinek lathato',
      'Vedd ki az erzekeny utvonalakat es hasznalj autentikaciot helyette',
      'Fontold meg az IP-alapu hozzaferes korlatozast admin feluletkre',
    ],
  },
  'ports.open_database': {
    mi_ez: 'Egy adatbazis port (pl. 3306/MySQL, 5432/PostgreSQL) nyitva van az internetrol.',
    miert_veszelyes: 'A nyilvanos adatbazis port brute-force es exploit tamadasoknak van kiteve. Sikeres tamadas eseten az osszes adat elerheto.',
    javitas: [
      'Zard be az adatbazis portot a tuzelfalon — csak belsoe halozatrol legyen elerheto',
      'Hasznalj SSH tunnelt vagy VPN-t a tavoli elereshez',
      'Ellenorizd, hogy az adatbazis nem az alapertelmezett jelszoval mukodik',
    ],
  },
};

/**
 * Fallback explanation for findings without a matching static template.
 */
export const FALLBACK_EXPLANATION: StaticExplanation = {
  mi_ez: 'Ez a talalt egy altalanos biztonsagi megfigyeles.',
  miert_veszelyes: 'A problema nem kritikus, de hosszu tavon gyengitheti a rendszer vedelmet.',
  javitas: [
    'Vizsgald felul a beallitast',
    'Konzultalj a dokumentacioval',
  ],
};
