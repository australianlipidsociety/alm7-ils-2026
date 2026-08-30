// ALM7 & 5th iLS Conference app configuration
// The Google Sheet is published to the web and is read directly by the app.
window.CONFERENCE_CONFIG = {
  spreadsheetId: "14ND-13ryxIg4rd704EmrFlowmv53WV6l",
  timezone: "Australia/Perth",
  sheets: {
    PROGRAM: "A4:O",
    SESSIONS: "A4:K",
    PRESENTATIONS: "A4:N",
    ABSTRACTS: "A4:L",
    SPEAKERS: "A4:J",
    VENUES: "A4:J",
    ANNOUNCEMENTS: "A4:I",
    SETTINGS: "A4:D"
  },
  optionalSheets: {
    SPONSORS: "A4:O"
  }
};
