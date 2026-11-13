# FrietVrijdag

Privéproject van Camiel: collega's bestellen op vrijdag friet bij De Posthoorn via een eigen
link, een rad kiest wie de hele rekening betaalt (Tikkie), de rest vinkt "Ik heb betaald" aan
en de betaler "Ontvangen". Gebruikers- en ontwerpuitleg staat in `README.md`; de uitleg voor
collega's (telefoon) is `docs/uitleg.html`.

## Harde afspraken
- **Nooit in WLX of DataBridge** (repo's, servers, werk-GitHub). Dit is privé.
- Git-identiteit: `Camiel20` / `camielsmits@live.nl`. Repo: github.com/Camiel20/frietvrijdag (openbaar).
- **Geen namen van collega's in de repo** (ook niet in tests, commits of deze file): namen staan
  alleen in Firestore. Testnamen in `tests/` zijn verzonnen.
- De oude Flask-versie (`C:\Projects\frietvrijdag-flask`) bevat namen in de git-historie: nooit publiceren.
- Antwoord in het Nederlands.

## Hoe het draait
- Site: GitHub Pages vanuit `main` / `docs` → https://camiel20.github.io/frietvrijdag/
  (bestelpagina `#t=<token>`, beheer `beheer.html`, uitleg `uitleg.html`). Push = live in ±1 min.
- Opslag: Firebase-project **`frietvrijdag-9e2df`** (Spark, gratis), Firestore `(default)`, eur3.
  Config in `docs/js/firebase-config.js` (niet geheim). Leeg `apiKey` = demo-modus (localStorage).
- Beveiliging zit volledig in `firestore.rules`. **Wijzig je die, dan moet Camiel ze zelf in de
  Firebase-console plakken** (Firestore → Rules → Publish); er is geen deploy-pipeline voor regels.
- Beheerder = Google-login + document `beheer/{uid}` (alleen via de console aan te maken).
  Collega's = anonieme login, gekoppeld via `koppelingen/{uid}` aan hun token.
- Menu: `tools/haal_menu.py` → `docs/menu.json`, nachtelijk via `.github/workflows/menu.yml`.

## Ontwikkelen
- Geen buildstap; ES-modules + Firebase SDK 10.14.1 van gstatic.
- `npm test` (node --test: bon-lezer, datums). `node --check docs/js/*.js` voor syntax.
- Lokaal draaien praat met de échte Firebase zodra de config gevuld is — test liever op een
  vrijdag die niet echt gebruikt wordt, of zet tijdelijk `apiKey` leeg (demo), maar commit dat niet.

## Stand (13-11-2026)
- Live in gebruik. Testvrijdag doorlopen (alle regels werken); testronde verwijderd.
- 15 collega's als deelnemer; een deel staat er nog alleen met voornaam → Camiel vult
  achternamen aan met de knop **Naam** (link blijft geldig).
- Beheer heeft: rondes (rad terugzetten, sluiten/heropenen, **Ronde verwijderen**), regels
  corrigeren, bon uitlezen, deelnemers (toevoegen, **Naam**, **Kopieer bericht** = WhatsApp-tekst
  met eigen link + uitleg, Nieuwe link, Uitzetten).
- Engels: bestelpagina via `&l=en` in de link of de knop NL/EN rechtsboven (onthouden per browser);
  teksten staan als `t('nl', 'en')` naast elkaar (`docs/js/taal.js`). Uitleg: `uitleg-en.html`.
  Beheer blijft Nederlands; knop **Bericht EN** geeft het welkomstbericht met Engelse link.
