// ALM7 & 5th iLS Conference — live Google Sheets powered app

const CONFIG = window.CONFERENCE_CONFIG;

const DB = {
  program: [],
  sessions: [],
  presentations: [],
  abstracts: [],
  speakers: [],
  venues: [],
  announcements: [],
  settings: {},
  loaded: false
};

let selectedProgramDate = "2026-10-18";
let selectedProgramFilter = "All";

const FILTER_ORDER = [
  "All", "Plenary", "Keynote", "Session", "Workshop", "Poster", "Break",
  "Lunch", "Registration", "AGM", "Social", "Opening", "Awards", "Closing", "Other"
];

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normaliseDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const au = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (au) return `${au[3]}-${String(au[2]).padStart(2,"0")}-${String(au[1]).padStart(2,"0")}`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,"0")}-${String(parsed.getDate()).padStart(2,"0")}`;
  }
  return s;
}

function normaliseTime(value) {
  if (!value) return "";
  const s = String(value).trim();
  const match = s.match(/(\d{1,2}):(\d{2})/);
  if (match) return `${String(Number(match[1])).padStart(2,"0")}:${match[2]}`;
  return s;
}

function parseMinutes(t) {
  if (!t || !String(t).includes(":")) return 0;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

function formatTime(t) {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return String(t);
  const suffix = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2,"0")} ${suffix}`;
}

function formatDate(dateString, options = {}) {
  if (!dateString) return "";
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("en-AU", {
    weekday: options.short ? "short" : "long",
    day: "numeric",
    month: options.short ? "short" : "long"
  });
}

function dateRangeLabel(start, end) {
  if (!start || !end) return "18–21 October 2026";
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${e.toLocaleDateString("en-AU", {month:"long"})} ${e.getFullYear()}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function getPerthNowParts() {
  const tz = DB.settings.Timezone || CONFIG.timezone || "Australia/Perth";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function daysBetween(a, b) {
  const d1 = new Date(`${a}T12:00:00`);
  const d2 = new Date(`${b}T12:00:00`);
  return Math.ceil((d2 - d1) / 86400000);
}

let loadingIndicatorTimer = null;

function showLoadingIndicator() {
  const el = document.querySelector("#data-status");
  if (!el) return;
  clearTimeout(loadingIndicatorTimer);
  loadingIndicatorTimer = setTimeout(() => {
    el.className = "data-status loading";
    el.innerHTML = '<span class="loading-spinner" aria-hidden="true"></span><span class="sr-only">Loading conference program</span>';
    el.hidden = false;
    el.style.display = "grid";
  }, 350);
}

function hideDataStatus() {
  clearTimeout(loadingIndicatorTimer);
  loadingIndicatorTimer = null;
  const el = document.querySelector("#data-status");
  if (!el) return;
  el.hidden = true;
  el.style.display = "none";
  el.className = "data-status";
  el.innerHTML = "";
}

function showDataError(message = "We’re having trouble loading the program. Please refresh and try again.") {
  clearTimeout(loadingIndicatorTimer);
  const el = document.querySelector("#data-status");
  if (!el) return;
  el.className = "data-status error";
  el.textContent = message;
  el.hidden = false;
  el.style.display = "block";
}

// Google Visualization JSONP loader. This avoids CORS problems when testing the app locally.
function loadSheet(sheetName, range) {
  return new Promise((resolve, reject) => {
    const callbackName = `__sheet_${sheetName}_${Date.now()}_${Math.floor(Math.random()*10000)}`;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${sheetName} timed out`));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = response => {
      try {
        if (!response || response.status === "error" || !response.table) {
          throw new Error(response?.errors?.[0]?.detailed_message || `Could not read ${sheetName}`);
        }
        const cols = response.table.cols.map((col, i) => col.label || col.id || `Column${i+1}`);
        const rows = response.table.rows.map(row => {
          const obj = {};
          cols.forEach((col, i) => {
            const cell = row.c?.[i];
            if (!cell) obj[col] = "";
            else if (cell.f !== undefined && cell.f !== null) obj[col] = cell.f;
            else obj[col] = cell.v ?? "";
          });
          return obj;
        });
        cleanup();
        resolve(rows);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const params = new URLSearchParams({
      sheet: sheetName,
      range,
      headers: "1",
      tqx: `out:json;responseHandler:${callbackName}`
    });
    const script = document.createElement("script");
    script.src = `https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq?${params.toString()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error(`Could not connect to ${sheetName}`));
    };
    document.head.appendChild(script);
  });
}

function published(row) {
  const status = String(row.Status || "Published").trim().toLowerCase();
  return !status || status === "published";
}

function buildDatabase(raw) {
  DB.sessions = raw.SESSIONS.filter(published);
  DB.presentations = raw.PRESENTATIONS.filter(published);
  DB.abstracts = raw.ABSTRACTS.filter(published);
  DB.speakers = raw.SPEAKERS;
  DB.venues = raw.VENUES;
  DB.announcements = raw.ANNOUNCEMENTS;
  DB.settings = Object.fromEntries(raw.SETTINGS.filter(r => r.Setting).map(r => [String(r.Setting).trim(), r.Value]));

  DB.settings.StartDate = normaliseDate(DB.settings.StartDate);
  DB.settings.EndDate = normaliseDate(DB.settings.EndDate);

  const venues = Object.fromEntries(DB.venues.map(v => [v.VenueID, v]));
  const sessions = Object.fromEntries(DB.sessions.map(s => [s.SessionID, s]));
  const abstracts = Object.fromEntries(DB.abstracts.map(a => [a.AbstractID, a]));
  const speakers = Object.fromEntries(DB.speakers.map(s => [s.SpeakerID, s]));

  const presentationsBySession = {};
  DB.presentations.forEach(p => {
    if (!p.SessionID) return;
    if (!presentationsBySession[p.SessionID]) presentationsBySession[p.SessionID] = [];
    const abs = abstracts[p.AbstractID] || {};
    const sp = speakers[p.SpeakerID] || {};
    presentationsBySession[p.SessionID].push({
      id: p.PresentationID,
      time: normaliseTime(p.StartTime),
      end: normaliseTime(p.EndTime),
      type: p.PresentationType,
      title: p.Title || abs.Title || "Untitled presentation",
      speakerId: p.SpeakerID,
      speaker: p.SpeakerDisplay || sp.DisplayName || "",
      authors: p.AuthorsDisplay || abs.Authors || "",
      affiliations: p.AffiliationsDisplay || abs.Affiliations || "",
      abstractId: p.AbstractID,
      abstract: abs.AbstractText || "",
      keywords: abs.Keywords || "",
      sequence: Number(p.Sequence || 999)
    });
  });
  Object.values(presentationsBySession).forEach(list => list.sort((a,b) => a.sequence - b.sequence || a.time.localeCompare(b.time)));

  DB.program = raw.PROGRAM.filter(published).filter(r => r.ProgramID).map(row => {
    const session = sessions[row.SessionID] || {};
    const venue = venues[row.VenueID] || {};
    return {
      id: row.ProgramID,
      date: normaliseDate(row.Date),
      start: normaliseTime(row.StartTime),
      end: normaliseTime(row.EndTime),
      type: row.Type || "Other",
      title: row.Title || session.SessionTitle || "Untitled event",
      venueId: row.VenueID,
      room: venue.VenueName || row.VenueID || "Venue TBC",
      sessionId: row.SessionID,
      speaker: row.SpeakerDisplay || "",
      description: row.Description || session.Description || "",
      chair: session.Chair || "",
      coChair: session.CoChair || "",
      track: session.Track || "",
      favouriteAllowed: String(row.FavouriteAllowed || "Yes").toLowerCase() !== "no",
      showOnHome: String(row.ShowOnHome || "Yes").toLowerCase() !== "no",
      sortOrder: Number(row.SortOrder || 999),
      presentations: row.SessionID ? (presentationsBySession[row.SessionID] || []) : []
    };
  }).sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start) || a.sortOrder - b.sortOrder);

  DB.loaded = true;
}

async function loadConferenceData() {
  showLoadingIndicator();
  try {
    const entries = Object.entries(CONFIG.sheets);
    const results = await Promise.all(entries.map(([name, range]) => loadSheet(name, range)));
    const raw = Object.fromEntries(entries.map(([name], i) => [name, results[i]]));
    buildDatabase(raw);
    applySettings();
    initialiseProgramDay();
    renderAll();
    hideDataStatus();
  } catch (error) {
    console.error(error);
    renderLoadError(error);
    showDataError();
  }
}

function applySettings() {
  const conferenceName = DB.settings.ConferenceName || "ALM7 & 5th iLS Conference";
  const location = DB.settings.Location || "Perth, Western Australia";
  const dateLabel = dateRangeLabel(DB.settings.StartDate, DB.settings.EndDate);
  document.title = conferenceName;
  document.querySelector(".hero .eyebrow").textContent = conferenceName;
  document.querySelector(".hero h1").textContent = location;
  document.querySelector(".hero-date").textContent = dateLabel;
}

function initialiseProgramDay() {
  const { date } = getPerthNowParts();
  const dates = getConferenceDates();
  selectedProgramDate = dates.includes(date) ? date : (DB.settings.StartDate || dates[0] || "2026-10-18");
  renderDayTabs();
}

function getConferenceDates() {
  const start = DB.settings.StartDate;
  const end = DB.settings.EndDate;
  if (start && end) {
    const out = [];
    const current = new Date(`${start}T12:00:00`);
    const finish = new Date(`${end}T12:00:00`);
    while (current <= finish && out.length < 14) {
      out.push(`${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,"0")}-${String(current.getDate()).padStart(2,"0")}`);
      current.setDate(current.getDate() + 1);
    }
    return out;
  }
  return [...new Set(DB.program.map(x => x.date))].filter(Boolean).sort();
}

function renderDayTabs() {
  const holder = document.querySelector(".day-tabs");
  const dates = getConferenceDates();
  holder.innerHTML = dates.map(date => {
    const d = new Date(`${date}T12:00:00`);
    return `<button class="day-tab ${date === selectedProgramDate ? "active" : ""}" data-date="${date}">
      ${d.toLocaleDateString("en-AU", {weekday:"short"})} <strong>${d.getDate()}</strong>
    </button>`;
  }).join("");
  holder.style.gridTemplateColumns = `repeat(${Math.max(1, dates.length)}, 1fr)`;
  holder.querySelectorAll(".day-tab").forEach(btn => btn.addEventListener("click", () => {
    selectedProgramDate = btn.dataset.date;
    renderDayTabs();
    renderProgram();
  }));
}

function getFavourites() {
  try { return JSON.parse(localStorage.getItem("alm7-favourites") || "[]"); }
  catch { return []; }
}

function updateFavouriteCount() {
  document.querySelector("#favourite-count").textContent = getFavourites().length;
}

function toggleFavourite(id) {
  const favourites = getFavourites();
  const next = favourites.includes(id) ? favourites.filter(x => x !== id) : [...favourites, id];
  localStorage.setItem("alm7-favourites", JSON.stringify(next));
  updateFavouriteCount();
  renderProgram();
  renderMyProgram();
}

function renderHome() {
  const happening = document.querySelector("#happening-now");
  const upNext = document.querySelector("#up-next");
  const todayList = document.querySelector("#today-program");
  const todayHeading = document.querySelector("#today-heading");
  if (!DB.loaded) return;

  const now = getPerthNowParts();
  const start = DB.settings.StartDate || DB.program[0]?.date;
  const end = DB.settings.EndDate || DB.program.at(-1)?.date;
  const todays = DB.program.filter(x => x.date === now.date && x.showOnHome);

  if (start && now.date < start) {
    const days = daysBetween(now.date, start);
    happening.innerHTML = `<div class="event-time">Conference countdown</div><div class="event-title">${days} day${days === 1 ? "" : "s"} to go</div><div class="event-meta">We’ll see you in ${escapeHTML(DB.settings.Location || "Perth")}</div>`;
    const first = DB.program.find(x => x.showOnHome);
    upNext.innerHTML = first ? eventCardHTML(first) : `<div class="event-title">Program coming soon</div>`;
    const firstDay = DB.program.filter(x => x.date === start && x.showOnHome);
    todayHeading.textContent = `${formatDate(start)} — Preview`;
    todayList.innerHTML = timelineHTML(firstDay.slice(0, 6), "No published items yet for opening day.");
  } else if (end && now.date > end) {
    happening.innerHTML = `<div class="event-time">Conference complete</div><div class="event-title">Thank you for joining us</div><div class="event-meta">ALM7 & 5th iLS Conference</div>`;
    upNext.innerHTML = `<div class="event-title">Program archive</div><div class="event-meta">Browse the full program and abstracts.</div>`;
    todayHeading.textContent = "Conference program";
    todayList.innerHTML = timelineHTML(DB.program.slice(0, 6), "");
  } else {
    const current = todays.filter(x => parseMinutes(x.start) <= now.minutes && now.minutes < parseMinutes(x.end));
    const next = todays.find(x => parseMinutes(x.start) > now.minutes);
    happening.innerHTML = current.length ? current.map(eventCardHTML).join("<hr class='mini-rule'>") : `<div class="event-title">Nothing scheduled right now</div><div class="event-meta">Check the full program for what’s coming up.</div>`;
    upNext.innerHTML = next ? eventCardHTML(next) : `<div class="event-title">That’s all for today</div>`;
    todayHeading.textContent = formatDate(now.date);
    todayList.innerHTML = timelineHTML(todays, "No published program items for today.");
  }

  renderAnnouncements();
}

function eventCardHTML(item) {
  return `<div class="event-time">${escapeHTML(formatTime(item.start))}–${escapeHTML(formatTime(item.end))}</div>
    <div class="event-title">${escapeHTML(item.title)}</div>
    <div class="event-meta">${escapeHTML(item.room)}${item.speaker ? " • " + escapeHTML(item.speaker) : ""}</div>`;
}

function timelineHTML(items, emptyMessage) {
  if (!items.length) return `<div class="empty-program">${escapeHTML(emptyMessage)}</div>`;
  return items.map(item => `<div class="timeline-item">
      <div class="timeline-time">${escapeHTML(formatTime(item.start))}</div>
      <div><div class="timeline-title">${escapeHTML(item.title)}</div><div class="timeline-meta">${escapeHTML(formatTime(item.start))}–${escapeHTML(formatTime(item.end))} • ${escapeHTML(item.room)}${item.presentations.length ? " • " + item.presentations.length + " presentations" : ""}</div></div>
      <div class="timeline-type">${escapeHTML(item.type)}</div>
    </div>`).join("");
}

function renderAnnouncements() {
  const holder = document.querySelector("#announcement-area");
  const now = getPerthNowParts().date;
  const active = DB.announcements.filter(a => {
    if (String(a.Active || "Yes").toLowerCase() === "no") return false;
    const from = normaliseDate(a.DisplayFrom);
    const until = normaliseDate(a.DisplayUntil);
    return (!from || now >= from) && (!until || now <= until);
  });
  holder.innerHTML = active.map(a => `<div class="announcement ${String(a.Priority).toLowerCase() === "urgent" ? "urgent" : ""}">
    <div class="announcement-title">📢 ${escapeHTML(a.Title || "Conference update")}</div>
    <div class="announcement-text">${escapeHTML(a.Message || "")}</div>
  </div>`).join("");
}

function availableProgramTypes() {
  const types = [...new Set(DB.program.map(x => x.type).filter(Boolean))];
  return FILTER_ORDER.filter(x => x === "All" || types.includes(x)).concat(types.filter(x => !FILTER_ORDER.includes(x)));
}

function renderProgramFilters() {
  const holder = document.querySelector("#program-filters");
  holder.innerHTML = availableProgramTypes().map(type => `<button class="filter-chip ${selectedProgramFilter === type ? "active" : ""}" data-filter="${escapeHTML(type)}">${escapeHTML(type)}</button>`).join("");
  holder.querySelectorAll(".filter-chip").forEach(btn => btn.addEventListener("click", () => {
    selectedProgramFilter = btn.dataset.filter;
    renderProgram();
  }));
}

function renderProgram() {
  if (!DB.loaded) return;
  renderProgramFilters();
  const q = (document.querySelector("#program-search")?.value || "").trim().toLowerCase();
  let items = DB.program.filter(item => item.date === selectedProgramDate);
  if (selectedProgramFilter !== "All") items = items.filter(item => item.type === selectedProgramFilter);
  if (q) items = items.filter(item => [item.title,item.type,item.room,item.description,item.chair,item.speaker,item.track,...item.presentations.map(p => `${p.title} ${p.authors} ${p.abstract} ${p.keywords}`)].join(" ").toLowerCase().includes(q));

  const list = document.querySelector("#program-list");
  document.querySelector("#program-summary-text").textContent = `${formatDate(selectedProgramDate)} • ${items.length} item${items.length === 1 ? "" : "s"} shown`;
  if (!items.length) {
    list.innerHTML = `<div class="empty-program">No published program items match this day, search or filter.</div>`;
    return;
  }
  const favourites = getFavourites();
  list.innerHTML = items.map(item => {
    const rowClass = ["Break","Lunch"].includes(item.type) ? "break-row" : item.type === "Social" ? "social-row" : ["Plenary","Keynote"].includes(item.type) ? "plenary-row" : item.type === "Workshop" ? "workshop-row" : "";
    const hasDetails = item.presentations.length || item.description || item.speaker || item.chair;
    const saved = favourites.includes(item.id);
    return `<article class="program-row ${rowClass}">
      <div class="program-time">${escapeHTML(formatTime(item.start))}<br>– ${escapeHTML(formatTime(item.end))}</div>
      <div class="program-line"></div>
      <div class="program-main">
        ${hasDetails ? `<button class="program-title-button" onclick="openSessionModal('${escapeHTML(item.id)}')">${escapeHTML(item.title)}</button>` : `<div class="program-title-button">${escapeHTML(item.title)}</div>`}
        <div class="program-meta">📍 ${escapeHTML(item.room)}${item.speaker ? " • " + escapeHTML(item.speaker) : ""}${item.chair ? " • Chair: " + escapeHTML(item.chair) : ""}</div>
        ${item.description ? `<div class="program-description">${escapeHTML(item.description)}</div>` : ""}
        <div class="program-badges"><span class="program-badge">${escapeHTML(item.type)}</span>${item.presentations.length ? `<span class="program-badge">${item.presentations.length} presentation${item.presentations.length === 1 ? "" : "s"}</span>` : ""}</div>
      </div>
      ${item.favouriteAllowed ? `<button class="program-favourite ${saved ? "saved" : ""}" onclick="toggleFavourite('${escapeHTML(item.id)}')" aria-label="${saved ? "Remove from" : "Add to"} My Program">${saved ? "★" : "☆"}</button>` : `<span></span>`}
    </article>`;
  }).join("");
}

function openSessionModal(id) {
  const item = DB.program.find(x => x.id === id);
  if (!item) return;
  const modal = document.querySelector("#session-modal");
  const content = document.querySelector("#session-modal-content");
  content.innerHTML = `<div class="modal-eyebrow">${escapeHTML(item.type)}</div>
    <h2 id="session-modal-title" class="modal-title">${escapeHTML(item.title)}</h2>
    <div class="modal-meta">${escapeHTML(formatTime(item.start))}–${escapeHTML(formatTime(item.end))} &nbsp; • &nbsp; 📍 ${escapeHTML(item.room)}${item.speaker ? " &nbsp; • &nbsp; " + escapeHTML(item.speaker) : ""}</div>
    ${item.description ? `<p class="modal-intro">${escapeHTML(item.description)}</p>` : ""}
    ${item.chair ? `<p class="modal-meta">Chair: ${escapeHTML(item.chair)}${item.coChair ? " • Co-chair: " + escapeHTML(item.coChair) : ""}</p>` : ""}
    ${item.presentations.length ? `<div class="presentation-list">${item.presentations.map((p, i) => `<div class="presentation">
      <div class="presentation-head">
        <div class="presentation-time">${escapeHTML(formatTime(p.time))}</div>
        <div><div class="presentation-title">${escapeHTML(p.title)}</div><div class="presentation-authors">${escapeHTML(p.authors || p.speaker)}${p.affiliations ? `<br>${escapeHTML(p.affiliations)}` : ""}</div></div>
        ${p.abstract ? `<button class="abstract-toggle" onclick="toggleAbstract(${i})">Abstract ▾</button>` : ""}
      </div>
      ${p.abstract ? `<div id="abstract-${i}" class="abstract-text">${escapeHTML(p.abstract)}</div>` : ""}
    </div>`).join("")}</div>` : ""}`;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function toggleAbstract(index) {
  document.querySelector(`#abstract-${index}`)?.classList.toggle("open");
}

function closeSessionModal() {
  const modal = document.querySelector("#session-modal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderMyProgram() {
  if (!DB.loaded) return;
  const ids = getFavourites();
  const box = document.querySelector("#my-program-list");
  const items = DB.program.filter(x => ids.includes(x.id)).sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start));
  if (!items.length) {
    box.innerHTML = "You haven't saved any sessions yet.";
    return;
  }
  box.innerHTML = items.map(item => `<div class="search-result my-program-row">
    <div><div class="search-result-type">${escapeHTML(formatDate(item.date))} • ${escapeHTML(item.type)}</div><div class="search-result-title">${escapeHTML(item.title)}</div><div class="search-result-meta">${escapeHTML(formatTime(item.start))}–${escapeHTML(formatTime(item.end))} • ${escapeHTML(item.room)}</div></div>
    <button class="program-favourite saved" onclick="toggleFavourite('${escapeHTML(item.id)}')" aria-label="Remove from My Program">★</button>
  </div>`).join("");
}

function buildSearchItems() {
  const items = [];
  DB.program.forEach(p => items.push({type:p.type, title:p.title, meta:`${formatDate(p.date, {short:true})} • ${formatTime(p.start)} • ${p.room}`, haystack:`${p.title} ${p.description} ${p.type} ${p.room} ${p.speaker} ${p.chair}`}));
  DB.presentations.forEach(p => {
    const abs = DB.abstracts.find(a => a.AbstractID === p.AbstractID) || {};
    items.push({type:p.PresentationType || "Presentation", title:p.Title || abs.Title, meta:`${p.SpeakerDisplay || p.AuthorsDisplay || ""}`, haystack:`${p.Title} ${p.SpeakerDisplay} ${p.AuthorsDisplay} ${p.AffiliationsDisplay} ${abs.AbstractText || ""} ${abs.Keywords || ""}`});
  });
  DB.speakers.filter(s => s.DisplayName).forEach(s => items.push({type:"Speaker", title:s.DisplayName, meta:s.Affiliation || "", haystack:`${s.DisplayName} ${s.Affiliation} ${s.Bio || ""}`}));
  return items;
}

function renderSearch() {
  const input = document.querySelector("#global-search");
  const box = document.querySelector("#search-results");
  const q = input.value.trim().toLowerCase();
  if (!q) { box.innerHTML = "Start typing to search."; return; }
  const matches = buildSearchItems().filter(item => `${item.title} ${item.meta} ${item.haystack}`.toLowerCase().includes(q)).slice(0, 40);
  box.innerHTML = matches.length ? matches.map(item => `<div class="search-result"><div class="search-result-type">${escapeHTML(item.type)}</div><div class="search-result-title">${escapeHTML(item.title)}</div><div class="search-result-meta">${escapeHTML(item.meta)}</div></div>`).join("") : "No results found.";
}

function renderLoadError(error) {
  document.querySelector("#program-list").innerHTML = `<div class="empty-program"><strong>Live program unavailable.</strong><br>${escapeHTML(error.message)}<br><br>Refresh the page after checking the Google Sheet publishing settings.</div>`;
  document.querySelector("#happening-now").innerHTML = `<div class="event-title">Program connection unavailable</div>`;
  document.querySelector("#up-next").innerHTML = `<div class="event-meta">Please refresh to try again.</div>`;
  document.querySelector("#today-program").innerHTML = "";
}


function renderAll() {
  updateFavouriteCount();
  renderHome();
  renderProgram();
  renderMyProgram();
}

function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const target = document.querySelector(`#page-${page}`) || document.querySelector("#page-home");
  target.classList.add("active");
  document.querySelectorAll(".nav-link, .mobile-nav button").forEach(btn => btn.classList.toggle("active", btn.dataset.page === page));
  window.scrollTo({top:0, behavior:"smooth"});
}

function goHome() { showPage("home"); }

function showVenueTab(tab) {
  document.querySelectorAll(".venue-tab").forEach(btn => {
    const active = btn.dataset.venueTab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".venue-panel").forEach(panel => panel.classList.remove("active"));
  document.querySelector(`#venue-panel-${tab}`)?.classList.add("active");
}

document.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.page)));
document.querySelectorAll("[data-venue-tab]").forEach(btn => btn.addEventListener("click", () => showVenueTab(btn.dataset.venueTab)));
document.querySelector("#program-search")?.addEventListener("input", renderProgram);
document.querySelector("#clear-program-filters")?.addEventListener("click", () => {
  selectedProgramFilter = "All";
  document.querySelector("#program-search").value = "";
  renderProgram();
});
document.querySelector("#global-search")?.addEventListener("input", renderSearch);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeSessionModal(); });

updateFavouriteCount();
loadConferenceData();


const WORKSHOP_FACILITATORS = {
  philipp: {
    name: "Dr Philipp Nitschke",
    role: "NMR Lead, Australian National Phenome Centre",
    photo: "assets/philipp-nitschke.jpg",
    bio: "Philipp leads NMR at the ANPC and develops advanced nuclear magnetic resonance methods for high-throughput metabolic phenotyping. His work focuses on quantitative lipoprotein, lipidomic and metabolite profiling, with applications in systemic biomarker discovery for complex disease and inflammatory responses."
  },
  reika: {
    name: "Dr Reika Masuda",
    role: "Lead Bioinformatician, Australian National Phenome Centre",
    photo: "assets/reika-masuda.jpg",
    bio: "Reika leads bioinformatics at the ANPC, applying advanced computational modelling and machine learning to large-scale metabolic and lipidomic datasets. Her research focuses on integrating complex omics data to identify systemic biomarkers linked to cardiovascular risk, infectious disease and inflammatory responses."
  },
  luke: {
    name: "Dr Luke Whiley",
    role: "Senior Lecturer, Curtin University; Adjunct, Australian National Phenome Centre",
    photo: "assets/luke-whiley.png",
    bio: "Luke leads the Lipid and Metabolic Phenotype Group within the Curtin Medical Research Institute and holds an adjunct appointment at the ANPC. His research spans targeted and untargeted LC-MS lipidomics across neurodegeneration, inflammatory injury and large human cohort studies."
  }
};

function openFacilitator(id) {
  const person = WORKSHOP_FACILITATORS[id];
  const modal = document.querySelector("#facilitator-modal");
  if (!person || !modal) return;

  const photo = document.querySelector("#facilitator-modal-photo");
  const name = document.querySelector("#facilitator-modal-name");
  const role = document.querySelector("#facilitator-modal-role");
  const bio = document.querySelector("#facilitator-modal-bio");

  photo.src = person.photo;
  photo.alt = person.name;
  name.textContent = person.name;
  role.textContent = person.role;
  bio.textContent = person.bio;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeFacilitator() {
  const modal = document.querySelector("#facilitator-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeFacilitator();
});

