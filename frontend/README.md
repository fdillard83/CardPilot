# CardPilot

CardPilot is a mobile-friendly sports trading card identifier. A collector can photograph the front of a card, optionally add the back, and receive a structured identification with visible evidence and a confidence score.

## Current milestone

- Camera or photo-library upload
- Optional card-back image for better identification
- Server-side OpenAI vision analysis (the API key never reaches the browser)
- Structured player, sport, team, year, manufacturer, set, number, variant, and feature fields
- Honest partial matches, confidence, and follow-up guidance
- Responsive review screen with a reminder to verify important details

CardPilot does not yet perform catalog-backed matching, pricing, condition grading, or authenticity checks. Those are separate future milestones.

## Run locally

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Copy `.env.example` to `.env` and add an OpenAI API key from the [OpenAI API dashboard](https://platform.openai.com/api-keys):

   ```env
   OPENAI_API_KEY=your_api_key_here
   ```

3. Start the web app and identification server together:

   ```powershell
   npm.cmd run dev
   ```

4. Open `http://localhost:5173`.

## Production-style run

```powershell
npm.cmd run build
npm.cmd start
```

Then open `http://localhost:8787`.

## Notes

- Supported images: JPG, PNG, WebP, and GIF, up to 12 MB each.
- The local server sends the selected images to the OpenAI Responses API for identification and does not write uploaded images to disk.
- The default model is `gpt-5.6-sol`. Override it with `OPENAI_MODEL` if needed.
- AI identification is a first-pass assistant, not a guarantee. Verify the printed card number, set, parallel, and serial numbering before a purchase, sale, or grading submission.
