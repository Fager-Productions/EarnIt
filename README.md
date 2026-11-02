# Ukelonn-app

En app for barn og foresatte med ukelønn/månedslønn, oppgaver og en intern sparekonto.

- Fast lønn: betales hver periode, også uten registrerte oppgaver.
- Obligatorisk lønn: betales når alle krav er oppfylt. Krever minst én obligatorisk oppgave.
- Bonus: ekstraoppgaver gir poeng. Det høyeste oppnådde nivået gir bonus; nivåets poeng brukes, resten overføres.
- De tre delene kan kombineres. Sett fast eller obligatorisk lønn til 0 for å deaktivere den delen.
- «Krev obligatoriske oppgaver før bonus» styrer utbetaling, ikke muligheten til å samle bonuspoeng.

Uten Supabase-konfigurasjon lagres data bare lokalt i nettleseren. Med Supabase bruker hver testfamilie sin egen konto og serverlagring. Oppsett: [Supabase-veiledningen](./supabase/README.md).

## Funksjoner

- To tilganger:
	- Barnetilgang: kan registrere utforte oppgaver.
	- Foreldretilgang: administrasjon av regler, nivaaer og vedlikehold.
- Foreldre kan forhåndsvise barnesiden, men utførte oppgaver registreres bare fra barnets innlogging. Ingen testregistrering i foreldremodus.
- I foreldrenes forhåndsvisning kan barnet velges ved å trykke på navnet øverst. Barnets egen innlogging har ingen profilvelger.
- Foreldreoversikten og banken viser alle barn som standard og kan filtreres med barnemenyene. Barnemenyen i innstillingene velger bare hvem lønn og regler redigeres for; den aktiverer eller deaktiverer ikke en konto.
- Sletting av barn krever at forelderen skriver «slette» i bekreftelsen. Barnets profil og tilhørende data fjernes; dette kan ikke angres i appen.
- Stotte for flere barn i samme app med egen profil per barn.
- Velg periode: uke eller maned.
- Sett fast lønn og lønn for obligatoriske oppgaver per uke eller måned.
- Definer obligatoriske oppgaver med antall ganger de ma gjores.
- Obligatoriske oppgaver opprettes øverst i modulen og vises som faste oppgavekort under. Endringer gjøres ved å slette og opprette en ny; registreringer beholdes og kan fjernes under Registreringer.
- Definer ekstraoppgaver med poengverdi.
- Opprettede ekstraoppgaver kan ikke redigeres. Slett oppgaven og opprett en ny for å endre navn, poeng eller «Up for grabs». Tidligere registreringer beholdes.
- Regler for poengtrekk opprettes og redigeres per barn under Innstillinger → Regler. Når poengtrekk er aktivert, vises reglene og poengverdien under «Hva kan gi poengtrekk?». Å opprette en regel trekker ingen poeng; bare foreldrenes «Utfør trekk» registrerer selve trekket.
- Definer flere nivaaer for ekstra utbetaling (min poeng -> ekstra kr).
- Registrer utforte oppgaver med dato/tid.
- Oppgaver er hvite før registrering, gule når obligatoriske oppgaver er delvis fullført og grønne når de er ferdige. Ekstraoppgaver fullføres med én registrering. Foreldre og barn kan fjerne oppgaveregistreringer under Registreringer; bare foreldre i foreldervisning kan angre poengtrekk.
- Barn har fire faner: Hjem, Oppgaver, Tidligere og Banken. Egne registreringer vises i den sammenleggbare seksjonen «Mine registreringer» under Oppgaver, hvor barnet kan angre oppgaveregistreringer, men ikke poengtrekk. Foreldre beholder fanen Registreringer.
- Avsluttede perioder beregnes ved innlogging/aktivitet, også uten registreringer. I skymodus gjør en innlogget forelder dette; det er foreløpig ingen serverjobb som kjører mens appen er lukket.
- Ingen manuell testknapp for periodelagring; eksisterende registreringer og historikk beholdes.
- Se historikk over tidligere perioder.
- Banken viser lønn, innskudd, uttak, renter og manuelle poengtrekk i transaksjonshistorikk, med CSV-eksport.
- I bankens poengvisning kan foreldre legge til eller trekke overførte poeng. Begge handlingene loggføres og endrer ikke kronebeløpet i banken. Tilførte poeng kan bidra til bonusnivået i den åpne perioden.

## Lønn og renter

For eksempel gir fast lønn 50 kr, obligatorisk lønn 100 kr og nådd bonusnivå 20 kr totalt 170 kr når kravene er oppfylt. Uten fullførte obligatoriske oppgaver blir det 50 kr, eller 70 kr hvis bonus ikke krever obligatoriske oppgaver.

Nye lønnsbeløp gjelder den åpne perioden. Historiske oppgjør endres ikke. Periodebytte er sperret mens den åpne perioden har registreringer; tidligere registreringer beholder sin periodetype og registrerte poengverdi.

Lønn krediteres banken ved periodens slutt, uten kunstig tilbakedatering av renter. Renter beregnes etter hele uke-/måned-/årsperioder fra hvert innskudd, også manuelle innskudd. Månedsslutt og skuddår håndteres med kalenderdatoer. Renter føres som penger og kan tas ut; allerede opptjente renter forsvinner ikke når hovedbeløpet tas ut. Beregninger avrundes til øre.

Ved renteendring opptjenes først renter etter den gamle regelen. En ny renteperiode starter på endringstidspunktet for gjenværende saldo. Uttak bruker de eldste tilgjengelige innskuddene først, inkludert opptjente renter. Banken er familiens interne regnskap: appen overfører ikke penger via bank eller Vipps.

Eldre data migreres til åpningssaldoer. Tidligere utbetalte beløp blir ikke tilgjengelige igjen. Gamle manuelle innskudd mangler dato og får derfor rentedato ved migrering; gamle uttak uten transaksjonsdato kan ikke rekonstrueres som fullstendig transaksjonshistorikk.

## Kom i gang

Kjor i prosjektmappen:

```bash
npm install
npm run dev
```

Bygg for produksjon:

```bash
npm run build
```

Kjor lint:

```bash
npm run lint
```

## Foreldretilgang og lokal testing

Det finnes ikke lenger en standard foreldre-PIN. I utviklingsmodus kan du aktivere en lokal admininnlogging ved å opprette `.env.local` i prosjektroten og sette:

```text
VITE_DEV_ADMIN_USERNAME=Fager
VITE_DEV_ADMIN_PASSWORD=velg-et-eget-passord
```

Passordet må være minst 8 tegn, inneholde et tall og et spesialtegn. Start utviklingsserveren på nytt etter at `.env.local` er endret. Admininnloggingen finnes bare i utvikling og skal ikke brukes som produksjonsinnlogging. Når du er logget inn som admin, kan du opprette foreldrekontoer i Innstillinger; opprett deretter barneprofil og kode der.

All data lagres lokalt i nettleseren (`localStorage`). Den synkroniseres ikke mellom enheter eller nettlesere. Eksporter en JSON-sikkerhetskopi før testing du ikke vil miste, og test gjenoppretting før du legger inn viktig historikk.

## Neste steg: backend

Supabase-integrasjonen er klargjort med separate familier, foreldre-/barneroller, passordgjenoppretting og konfliktkontroll ved samtidig lagring. Du kan starte med én familie og legge til flere senere. Midlertidige passord skrives kun til en privat, gitignorert fil. Første innlogging krever passordbytte. Bruk passordgjenoppretting, ikke delte reservekontoer.

Se [oppsett, kontoer og manuelle backendtester](./supabase/README.md). Ingen eksterne prosjekter eller kontoer er opprettet automatisk. Skybruk krever internett; det finnes ikke en offline-kø for endringer.

## Installer på telefon eller datamaskin

Publiser appen på en HTTPS-adresse, og del adressen med testerne. «Installer app» og plattformveiledningen er tilgjengelig før og etter innlogging.

- iPhone/iPad: åpne i Safari → Del → Legg til på Hjem-skjerm.
- Android: åpne i Chrome → Installer app, eller nettlesermenyen → Legg til på startskjermen.
- Windows/Mac: Chrome/Edge → installasjonsikon i adressefeltet. Nyere Safari på Mac støtter Arkiv → Legg til i Dock.

Dette er en PWA, ikke en App Store-/Play Store-pakke. Ikoner i PNG-format og Apple-hjemskjermikon er inkludert. Ikonene kan regenereres med `node tools/generate-pwa-icons.mjs`.
