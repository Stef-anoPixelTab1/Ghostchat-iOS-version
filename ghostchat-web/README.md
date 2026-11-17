# Ghostchat web (PWA)

Si apre da Safari/Chrome e si installa nella schermata Home. Stesso backend dell'app Android e iPhone
(Supabase + LiveKit): account, chat, vocali e chiamate sono condivisi.

- iOS 26 o superiore: interfaccia Liquid Glass (CSS). Altrimenti stile classico. Si può forzare in Impostazioni.
- Funziona su Android, iPhone e computer.

## Pubblicazione con GitHub Pages
1. Carica la cartella `ghostchat-web` nel repository (accanto alle altre).
2. Crea il file `.github/workflows/deploy-web.yml` con il contenuto di `deploy-web.yml`.
3. Repository → Settings → Pages → Source: **GitHub Actions**.
4. I secrets `SUPABASE_URL` e `SUPABASE_KEY` sono gli stessi già usati per le altre app.
5. Actions → Publish web app → Run workflow. L'indirizzo compare nel riepilogo, di solito
   `https://TUONOME.github.io/NOMEREPO/`.

Nota: GitHub Pages gratuito richiede un repository **pubblico**. La chiave "anon" di Supabase è pensata
per stare in un sito pubblico: i dati sono protetti dalle regole RLS dello schema SQL.

## Installazione su iPhone
Apri l'indirizzo con **Safari** → Condividi → **Aggiungi alla schermata Home**.
Apri una volta l'app da Safari prima di installarla: serve a riconoscere la versione di iOS (Liquid Glass).
