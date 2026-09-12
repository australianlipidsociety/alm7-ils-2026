# ALM7 & 5th iLS Conference App

Conference app for ALM7 & 5th iLS Conference, Perth, Western Australia — 18–21 October 2026.

The live conference program is managed through Google Sheets.

## Sponsors tab

The app can optionally read a Google Sheets tab named `SPONSORS`.
Use the column headings in `SPONSORS_TEMPLATE.csv`. The app will continue to work normally before this tab is created.

For Platinum sponsors, link `PresentationID` and/or `AbstractID` to an existing conference talk.
For Gold and Silver sponsors, their card automatically identifies the Silver Room and can display a poster abstract.


## Abstract presenting author and affiliations

The `ABSTRACTS` sheet now supports one additional column named exactly:

`PresentingAuthor`

Add it as the next column after the existing ABSTRACTS columns. The app reads `ABSTRACTS` through column M.

`PresentingAuthor` should contain the presenting author's name exactly as it appears in the `Authors` cell. The app underlines that author wherever the abstract is displayed.

To link authors to affiliations with superscript numbers, enter the existing `Authors` and `Affiliations` cells using this format:

Authors:
`Jane Smith^1; John Doe^1,2; Alex Lee^2`

Affiliations:
`1^Murdoch University; 2^Curtin University`

This displays as Jane Smith¹; John Doe¹,²; Alex Lee², followed by numbered affiliations. Semicolons between authors/affiliations are recommended.
