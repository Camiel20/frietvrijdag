# 🍟 FrietVrijdag

Collega's kiezen hun friet via een eigen link, met het menu en de prijzen van
[De Posthoorn](https://deposthoorn.ultimatumapp.com/). Een rad van fortuin beslist wie de
rekening betaalt; die zet zijn Tikkie-link erin, de rest betaalt en vinkt het af, en de betaler
bevestigt per persoon. De betaler kan de kassabon uitlezen met de camera en ziet waar bon en
bestellingen verschillen. Er wordt niets automatisch verdeeld: verschillen worden alleen gemeld.

Draait gratis: GitHub Pages (de site), Firebase Firestore (de bestellingen) en een
GitHub Action (het menu). Geen server, geen AI-sleutel. De bon wordt in de browser gelezen
(Tesseract.js); de foto verlaat het apparaat niet.

| Pagina | Voor wie |
|---|---|
| `index.html#t=…` | iedereen, via zijn eigen link: openen, bestellen, rad, betalen |
| `beheer.html` | jij: de vaste lijst met links, en ingrijpen als er iets mis gaat |

## Een vrijdag

Alles gaat via de eigen link; de beheerpagina heb je daarvoor niet nodig.

1. **Openen.** Wie zin heeft in friet, opent de bestelling. Er kan er maar één per vrijdag zijn
   (het is altijd de bestelling van vandaag, of van de eerstvolgende vrijdag).
2. **Bestellen.** Iedereen tikt aan wat hij wil; het wordt vanzelf bewaard.
3. **Het rad.** Iemand die besteld heeft, draait aan het rad. De bestelling sluit en het rad
   kiest uit iedereen die besteld heeft wie de rekening betaalt. Iedereen ziet het rad draaien
   (ook wie de pagina later opent; met *Nog een keer zien* speel je hem opnieuw af).
4. **De betaler** kopieert de bestellijst, bestelt, en plakt zijn **Tikkie-link** op de pagina.
   Optioneel: bon uitlezen voor de controle.
5. **Betalen.** Ieder ziet "Jij betaalt Cees € 7,80", betaalt via de link en vinkt
   **Ik heb betaald** aan. De betaler ziet "zegt: betaald" en vinkt **Ontvangen** aan zodra het
   op zijn rekening staat. Met **Kopieer herinnering** stuurt hij wie nog niet betaald heeft
   een berichtje.
6. Staat er van een eerdere vrijdag nog iets open, dan zie je dat bovenaan je pagina.

Beheer kan het rad terugzetten, een ronde sluiten of heropenen, regels toevoegen of weghalen en
beide vinkjes corrigeren.

## Eenmalig instellen

### 1. Firebase (gratis Spark-abonnement, geen creditcard)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Project toevoegen**
   (naam bv. `frietvrijdag`; Google Analytics mag uit).
2. **Build → Firestore Database → Database maken** → locatie in Europa (bv. `eur3`) →
   *productiemodus*.
3. Tabblad **Regels**: vervang alles door de inhoud van [`firestore.rules`](firestore.rules) → **Publiceren**.
4. **Build → Authentication → Aan de slag** en schakel twee aanmeldmethoden in:
   **Google** (voor jou als beheerder) en **Anoniem** (collega's; zij merken daar niets van,
   het koppelt alleen hun browser aan hun link).
   Onder *Instellingen → Geautoriseerde domeinen*: voeg `camiel20.github.io` toe.
5. **Projectinstellingen → Je apps → `</>` (web)** → app registreren (Hosting niet nodig) →
   kopieer `apiKey`, `authDomain`, `projectId`, `appId` naar
   [`docs/js/firebase-config.js`](docs/js/firebase-config.js). Die waarden zijn niet geheim;
   de beveiliging zit in de regels.

### 2. GitHub Pages

1. Zet deze map in een repo en push (zie onder).
2. Repo → **Settings → Pages** → *Deploy from a branch* → `main` / `/docs`.
3. Na ±1 minuut: `https://camiel20.github.io/frietvrijdag/beheer.html`.
4. **Actions → Menu ophalen → Run workflow** voor het eerste verse menu. Daarna draait hij
   elke nacht en vrijdagochtend vanzelf, en commit alleen als er iets veranderd is.

### 3. Jezelf beheerder maken

1. Open `beheer.html` → **Inloggen met Google**. Je ziet "Nog geen beheerder" met je ID.
2. Firebase → Firestore → **Collectie starten**: `beheer` → document-ID = dat ID →
   veld `naam` (string) met je naam → opslaan. Pagina herladen.
3. **Deelnemers** → plak de namen (één per regel) → **Kopieer alle links** of per persoon
   **Kopieer**, en stuur ieder zijn eigen link.

## Beveiliging, kort

- De repo is openbaar maar bevat **geen namen**: deelnemers staan alleen in Firestore.
- De link-token is de sleutel van een collega en staat nergens leesbaar: collega's zien elkaars
  naam en bestelling (nodig voor het rad en de betalingen), nooit elkaars link.
- Een collega kan alleen zijn eigen bestelling wijzigen (zolang de ronde open is), alleen zijn
  eigen "Ik heb betaald" zetten, en alleen als betaler "Ontvangen" en de Tikkie-link zetten.
  Draaien kan één keer per ronde, en het rad kan alleen iemand kiezen die besteld heeft.
- Link gelekt of iemand weg: **Nieuwe link** of **Uitzetten**; de oude link werkt dan meteen niet meer.
- Beheerder ben je alleen met een document `beheer/{jouw-ID}`, en dat kan alleen via de
  Firebase-console worden aangemaakt.
- Wie de uitslag kiest, is de browser van degene die draait. Iemand die heel handig is met de
  ontwikkelaarstools kan dus vals spelen; "gedraaid door" staat erbij, en beheer kan het rad terugzetten.

## Lokaal ontwikkelen

```bash
npm run dev      # http://localhost:5056 — zonder firebase-config draait alles in DEMO-modus (localStorage)
npm test         # bon-lezer en vergelijking (node --test)
npm run menu     # menu.json lokaal verversen
```

Bestanden: `docs/` is de site (`js/bestellen.js`, `js/beheer.js`, `js/bon.js` = bon lezen en
vergelijken, `js/opslag.js` = Firestore of demo), `tools/haal_menu.py` haalt het menu op,
`.github/workflows/menu.yml` draait dat elke nacht.

## Goed om te weten

- GitHub zet geplande Actions in een openbare repo uit na 60 dagen zonder activiteit. Je krijgt
  dan een mail; met één klik (*Enable workflow*) loopt hij weer.
- De menu-ophaler leest de HTML van de Posthoorn-site. Verandert die site van opbouw, dan faalt
  de Action (bewust: bij minder dan 50 producten blijft het oude menu staan) en krijg je een mail.
- Productopties (extra saus, groot/klein) staan niet als keuze in het menu; dat gaat via het
  opmerkingenveld per regel.
