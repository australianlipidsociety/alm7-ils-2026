# ALM7 & 5th iLS Conference App — Live Google Sheets version

This version reads the published Google Sheet directly. No database, paid backend or app-builder subscription is required.

## Connected spreadsheet

Spreadsheet ID is stored in `js/config.js`:

`14ND-13ryxIg4rd704EmrFlowmv53WV6l`

The app reads these tabs:

- PROGRAM
- SESSIONS
- PRESENTATIONS
- ABSTRACTS
- SPEAKERS
- VENUES
- ANNOUNCEMENTS
- SETTINGS

## Important spreadsheet rule

Keep the column names in row 4 exactly as they are. You can add/edit rows underneath them freely.

Only rows with `Status = Published` are shown by the app. Blank Status is also treated as published for compatibility.

## Testing

Open `index.html`. A small status pill will say `Live program connected to Google Sheets` when the connection succeeds.

Try changing a published PROGRAM title in Google Sheets, then refresh the app. Google publishing can cache changes briefly, so a newly edited value may not appear instantly.

## How the live join works

PROGRAM → SessionID → SESSIONS → SessionID → PRESENTATIONS

PRESENTATIONS → AbstractID → ABSTRACTS

PRESENTATIONS → SpeakerID → SPEAKERS

PROGRAM / SESSIONS → VenueID → VENUES

## Current functionality

- live Google Sheets data
- four conference dates generated from SETTINGS
- full program filters and search
- session details built from linked tabs
- expandable abstracts
- venue names resolved from VenueID
- favourites saved on the attendee's device
- My Program
- home page pre-conference countdown / Happening Now / Up Next
- active announcements
- global search across program, talks, abstracts and speakers
- friendly loading and error states
