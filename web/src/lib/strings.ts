/**
 * Every piece of text the interface shows, in one place.
 *
 * The rule from CLAUDE.md is that code, identifiers and log output are English
 * while the interface speaks German. Keeping the German in a single module is
 * what makes a later i18n pass a matter of swapping this file, and it keeps
 * wording consistent between screens that were written weeks apart.
 *
 * Texts that need a value are functions rather than templates with
 * placeholders, so the type checker catches a missing argument.
 */

export const strings = {
  app: {
    name: 'product-rating',
    tagline: 'Produkte scannen, fotografieren und bewerten',
  },

  nav: {
    label: 'Hauptnavigation',
    catalogue: 'Katalog',
    scan: 'Scannen',
    ratings: 'Bewertungen',
    settings: 'Einstellungen',
  },

  common: {
    loading: 'Wird geladen …',
    retry: 'Erneut versuchen',
    cancel: 'Abbrechen',
    save: 'Speichern',
    saving: 'Wird gespeichert …',
    saved: 'Gespeichert.',
    edit: 'Bearbeiten',
    delete: 'Löschen',
    deleting: 'Wird gelöscht …',
    confirmDelete: 'Wirklich löschen?',
    back: 'Zurück',
    close: 'Schließen',
    logout: 'Abmelden',
    optional: 'optional',
    toCatalogue: 'Zum Katalog',
    loadMore: 'Mehr laden',
    loadingMore: 'Wird nachgeladen …',
    copy: 'Kopieren',
    copied: 'Kopiert.',
    copyFailed: 'Kopieren hat nicht geklappt – bitte von Hand markieren.',
    never: 'nie',
  },

  session: {
    checking: 'Anmeldung wird geprüft …',
    unreachable: 'Der Server ist gerade nicht erreichbar.',
    loggedInAs: (username: string) => `Angemeldet als ${username}`,
    logoutFailed: 'Abmelden hat nicht geklappt.',
  },

  login: {
    title: 'Anmelden',
    intro: 'Melde dich mit deinem Konto an.',
    username: 'Benutzername',
    password: 'Passwort',
    submit: 'Anmelden',
    submitting: 'Wird angemeldet …',
    wrongCredentials: 'Benutzername oder Passwort ist falsch.',
    noAccount: 'Noch kein Konto? Mit einem Einladungscode registrieren.',
    toRegister: 'Registrieren',
  },

  register: {
    title: 'Registrieren',
    intro: 'Ein Konto entsteht nur mit einem Einladungscode.',
    username: 'Benutzername',
    usernameHint: '3 bis 32 Zeichen: Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.',
    password: 'Passwort',
    email: 'E-Mail',
    emailHint: 'Wird nur für Hinweise genutzt und kann leer bleiben.',
    invite: 'Einladungscode',
    inviteHint: 'In der Form A1B2-C3D4-E5F6, von einer Administratorin oder einem Administrator.',
    submit: 'Konto anlegen',
    submitting: 'Konto wird angelegt …',
    haveAccount: 'Schon ein Konto?',
    toLogin: 'Anmelden',
  },

  reset: {
    title: 'Neues Passwort setzen',
    intro: 'Über diesen Link kannst du ein neues Passwort für dein Konto wählen.',
    forUser: (username: string) => `Konto: ${username}`,
    checking: 'Link wird geprüft …',
    password: 'Neues Passwort',
    passwordHint: 'Nach dem Speichern wirst du gleich angemeldet.',
    submit: 'Passwort setzen',
    submitting: 'Wird gesetzt …',
    invalid:
      'Dieser Link gilt nicht mehr. Er ist abgelaufen, wurde schon benutzt oder wurde durch einen neueren ersetzt – bitte einen neuen anfordern.',
    missing:
      'In der Adresse fehlt der Link-Code. Bitte den Link aus der Nachricht vollständig öffnen.',
    toLogin: 'Zur Anmeldung',
  },

  /** Field names, used in labels and in messages that have to name a field. */
  fields: {
    username: 'Benutzername',
    password: 'Passwort',
    newPassword: 'Neues Passwort',
    currentPassword: 'Aktuelles Passwort',
    email: 'E-Mail',
    invite: 'Einladungscode',
    ean: 'EAN',
    name: 'Name',
    brand: 'Marke',
    category: 'Kategorie',
    notes: 'Notizen',
    comment: 'Kommentar',
  },

  /**
   * What a failed client side check means, keyed by field. The server validates
   * everything a second time; these texts only save a round trip.
   */
  validation: {
    fallback: 'Diese Eingabe passt nicht.',
    username:
      'Der Benutzername braucht 3 bis 32 Zeichen: Buchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich.',
    password: 'Bitte ein Passwort eingeben.',
    email: 'Bitte eine gültige E-Mail-Adresse eingeben oder das Feld leer lassen.',
    invite: 'Bitte den Einladungscode eingeben, zum Beispiel A1B2-C3D4-E5F6.',
    ean: 'Diese EAN stimmt nicht – bitte die Ziffern prüfen.',
    name: 'Bitte einen Namen eingeben.',
    comment: 'Der Kommentar ist zu lang.',
  },

  errors: {
    network: 'Keine Verbindung zum Server. Bitte die Netzwerkverbindung prüfen.',
    unauthorized: 'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.',
    forbidden: 'Dafür fehlen die Rechte.',
    notFound: 'Das gibt es hier nicht (mehr).',
    conflict: 'Das gibt es schon.',
    invalidRequest: 'Die Eingabe passt nicht. Bitte prüfen.',
    tooLarge: 'Die Datei ist zu groß.',
    tooLargeMb: (megabytes: number) => `Das Bild ist größer als die erlaubten ${megabytes} MB.`,
    rateLimited: (seconds: number) =>
      `Zu viele Versuche. Bitte ${seconds} Sekunden warten und es dann noch einmal probieren.`,
    server: 'Der Server hat einen Fehler gemeldet. Bitte später erneut versuchen.',
    unknown: 'Unerwarteter Fehler.',
    passwordTooShort: (minimum: number) =>
      `Das Passwort muss mindestens ${minimum} Zeichen lang sein.`,
    usernameTaken: 'Dieser Benutzername ist schon vergeben.',
    inviteInvalid: 'Der Einladungscode ist ungültig, abgelaufen oder schon benutzt.',
    passwordResetRequired:
      'Für dieses Konto muss ein neues Passwort gesetzt werden. Bitte einen Passwort-Link von der Verwaltung anfordern.',
    resetLinkInvalid:
      'Dieser Link gilt nicht mehr. Er ist abgelaufen, wurde schon benutzt oder wurde ersetzt.',
    eanTaken: 'Zu dieser EAN gibt es schon ein Produkt.',
    unsupportedImage: 'Dieses Bildformat wird nicht angenommen.',
    photoUnreadable: 'Diese Datei lässt sich nicht als Bild lesen.',
  },

  notFound: {
    title: 'Seite nicht gefunden',
    text: 'Diese Adresse gehört zu keiner Ansicht der App.',
  },

  /* ------------------------------------------------------- offline and PWA */

  offline: {
    /** The strip in the running app; short, it sits above the navigation. */
    banner: 'Offline – Änderungen lassen sich gerade nicht speichern.',
    title: 'Keine Verbindung',
    text: 'Dieses Gerät ist offline. Der Katalog liegt auf dem Server, deshalb geht es erst weiter, wenn die Verbindung zurück ist.',
    hint: 'Die App selbst ist geladen und startet auch ohne Netz.',
  },

  /** The offline queue: capturing at the shelf, and getting it up later. */
  offlineCapture: {
    offer:
      'Das ließ sich nicht speichern – das Gerät hat gerade keine Verbindung. Soll die Eingabe gemerkt und später übertragen werden?',
    keep: 'Offline merken',
    keeping: 'Wird gemerkt …',
    kept: 'Gemerkt. Wird übertragen, sobald wieder eine Verbindung besteht.',

    title: 'Offline erfasst',
    intro:
      'Was ohne Verbindung eingegeben wurde, wartet hier auf die Übertragung. Zugeordnet wird es über die EAN – ob daraus ein neues Produkt wird oder ein Zusatz zu einem vorhandenen, entscheidet sich erst bei der Übertragung.',
    empty: 'Nichts offen – alles ist übertragen.',
    waiting: (count: number) =>
      count === 1 ? '1 Erfassung wartet' : `${count} Erfassungen warten`,
    sync: 'Jetzt übertragen',
    syncing: 'Wird übertragen …',
    syncResult: (synced: number) =>
      synced === 1 ? '1 Erfassung übertragen.' : `${synced} Erfassungen übertragen.`,
    capturedAt: (date: string) => `Erfasst am ${date}`,
    contains: 'Enthält',
    partProduct: 'Produktdaten',
    partRating: (stars: number) => `Bewertung (${stars} von 5)`,
    partPrice: (amount: string) => `Preis (${amount})`,
    partPhotos: (count: number) => (count === 1 ? '1 Foto' : `${count} Fotos`),
    statePending: 'Wartet',
    stateConflict: 'Rückfrage',
    stateFailed: 'Abgelehnt',
    conflictTitle: 'Diese Bewertung wurde inzwischen woanders geändert',
    conflictText: (mine: number, theirs: number, date: string) =>
      `Offline erfasst: ${mine} von 5. Auf dem Server steht seit ${date}: ${theirs} von 5.`,
    keepMine: 'Meine Offline-Eingabe',
    keepServer: 'Fassung vom Server',
    retry: 'Erneut versuchen',
    discard: 'Verwerfen',
    discardConfirm: 'Wirklich verwerfen?',
  },

  update: {
    title: 'Neue Version verfügbar',
    text: 'Sie wird beim nächsten Neuladen übernommen.',
    reload: 'Jetzt neu laden',
    later: 'Später',
  },

  /* --------------------------------------------------------------- scanner */

  scan: {
    title: 'Scannen',
    intro: 'Halte den Barcode in den Rahmen.',
    start: 'Kamera starten',
    starting: 'Kamera wird gestartet …',
    stop: 'Kamera anhalten',
    frameLabel: 'Suchbereich für den Barcode',
    videoLabel: 'Kamerabild',
    searching: 'Suche im Katalog …',
    found: (ean: string) => `Gefunden: ${ean}`,
    torchOn: 'Licht an',
    torchOff: 'Licht aus',
    torchFailed: 'Das Licht lässt sich an dieser Kamera nicht schalten.',
    cameraSelect: 'Kamera',
    manualTitle: 'EAN von Hand eingeben',
    manualIntro: 'Geht immer – auch ohne Kamera oder bei einem beschädigten Barcode.',
    manualSubmit: 'Suchen',
    manualHint: '8, 12 oder 13 Ziffern, Leerzeichen und Bindestriche dürfen mit.',

    /** One explanation per reason the camera is unavailable. */
    problem: {
      insecureContext:
        'Die Kamera braucht eine verschlüsselte Verbindung. Diese Seite läuft über HTTP – bitte die App über HTTPS aufrufen. Die Eingabe von Hand funktioniert weiterhin.',
      unsupported:
        'Dieser Browser kann keine Kamera öffnen. Bitte die EAN von Hand eingeben oder einen anderen Browser verwenden.',
      denied:
        'Der Zugriff auf die Kamera wurde abgelehnt. In den Einstellungen des Browsers lässt er sich für diese Seite wieder erlauben.',
      missing: 'Es wurde keine Kamera gefunden.',
      unavailable:
        'Die Kamera ist gerade belegt – vermutlich von einer anderen App oder einem anderen Tab.',
      unknown: 'Die Kamera lässt sich nicht öffnen.',
    },
  },

  /* -------------------------------------------------------------- products */

  product: {
    newTitle: 'Neues Produkt',
    newIntro: 'Diese EAN ist noch nicht im Katalog. Lege das Produkt an.',
    editTitle: 'Produkt bearbeiten',
    nameHint: 'So, wie du das Produkt im Katalog wiederfinden möchtest.',
    categoryHint: 'Vorhandene Kategorien stehen zur Auswahl, neue dürfen dazukommen.',
    categoryList: 'Vorhandene Kategorien',
    notesHint: 'Platz für alles, was du dir merken willst.',
    create: 'Produkt anlegen',
    creating: 'Wird angelegt …',
    createdBy: (date: string) => `Angelegt am ${date}`,
    updatedAt: (date: string) => `Zuletzt geändert am ${date}`,
    eanLabel: 'EAN',
    existsAlready: 'Zu dieser EAN gibt es schon ein Produkt.',
    toExisting: 'Zum vorhandenen Produkt',
    deleteTitle: 'Produkt löschen',
    deleteWarning:
      'Das Produkt wandert mit allen Bewertungen und Fotos in den Papierkorb. Eine Administratorin oder ein Administrator kann es von dort zurückholen, bis der Papierkorb geleert wird.',
    deleteConfirm: 'In den Papierkorb',
    deleted: 'Das Produkt liegt im Papierkorb.',
    adminOnlyDelete: 'Produkte löschen dürfen nur Administratoren.',
    noBrand: 'Ohne Marke',
    noCategory: 'Ohne Kategorie',
    notes: 'Notizen',
  },

  /* ---------------------------------------------------------------- photos */

  photo: {
    title: 'Fotos',
    take: 'Foto aufnehmen',
    choose: 'Bild auswählen',
    preview: 'Vorschau',
    previewAlt: 'Vorschau des ausgewählten Bildes',
    upload: 'Hochladen',
    uploading: 'Wird hochgeladen …',
    preparing: 'Bild wird verkleinert …',
    progress: (percent: number) => `${percent} %`,
    uploaded: 'Das Foto wurde hochgeladen.',
    retry: 'Upload wiederholen',
    discard: 'Verwerfen',
    empty: 'Noch kein Foto.',
    setPrimary: 'Als Hauptbild',
    isPrimary: 'Hauptbild',
    moveUp: 'Nach vorn',
    moveDown: 'Nach hinten',
    moveUpFor: (index: number) => `Foto ${index} nach vorn schieben`,
    moveDownFor: (index: number) => `Foto ${index} nach hinten schieben`,
    orderHint: 'Das erste Foto ist das Hauptbild und steht auf den Kacheln im Katalog.',
    remove: 'Foto löschen',
    removed: 'Das Foto wurde gelöscht.',
    foreign: 'Fotos anderer Nutzer lassen sich nicht löschen.',
    alt: (index: number) => `Produktfoto ${index}`,
  },

  /* ---------------------------------------------------------------- prices */

  price: {
    title: 'Preise',
    intro: 'Was hat es zuletzt gekostet, und wo?',
    empty: 'Noch kein Preis erfasst.',
    add: 'Preis erfassen',
    adding: 'Wird gespeichert …',
    amount: 'Preis',
    amountHint: 'Zum Beispiel 1,99 – Komma oder Punkt, beides geht.',
    amountInvalid: 'Bitte einen Betrag wie 1,99 eingeben.',
    shop: 'Einkaufsort',
    shopHint: 'Wo gekauft? Vorhandene Orte stehen zur Auswahl.',
    shopList: 'Bereits verwendete Einkaufsorte',
    noShop: 'Ohne Ort',
    note: 'Notiz',
    noteHint: 'Zum Beispiel „Angebot“ oder „500-g-Packung“.',
    date: 'Einkaufsdatum',
    dateHint: 'Standard ist heute; ein Kassenbon von letzter Woche darf zurückdatiert werden.',
    lowest: 'Günstigster erfasster Preis',
    latest: 'Zuletzt bezahlt',
    remove: 'Preis löschen',
    removeFor: (amount: string) => `Eintrag über ${amount} löschen`,
    recordedBy: (username: string) => `erfasst von ${username}`,
    unknownUser: 'Gelöschtes Konto',
    capped: 'Es werden die 50 jüngsten Einträge gezeigt.',
  },

  /* --------------------------------------------------------------- ratings */

  rating: {
    own: 'Deine Bewertung',
    ownNone: 'Noch nicht bewertet',
    average: 'Durchschnitt',
    averageNone: 'Noch keine Bewertung',
    count: (count: number) => (count === 1 ? '1 Bewertung' : `${count} Bewertungen`),
    starsLabel: 'Sterne',
    starLabel: (stars: number) => (stars === 1 ? '1 Stern' : `${stars} Sterne`),
    starsOf: (stars: number) => `${stars} von 5 Sternen`,
    comment: 'Kommentar',
    commentHint: 'Was war gut, was nicht?',
    save: 'Bewertung speichern',
    remove: 'Bewertung entfernen',
    removed: 'Deine Bewertung wurde entfernt.',
    zeroHint: 'Null Sterne sind ein Urteil – wer nicht bewerten will, lässt es leer.',

    /* Die Bewertungen der anderen im Haushalt, auf der Produktseite. */
    householdTitle: 'Bewertungen im Haushalt',
    householdEmpty: 'Dieses Produkt hat noch niemand bewertet.',
    householdOnlyYours: 'Bisher hast nur du bewertet.',
    householdYou: 'Du',
    householdUnknownUser: 'Gelöschtes Konto',
    householdRatedAt: (date: string) => `Bewertet am ${date}`,
  },

  /* ------------------------------------------------------------- catalogue */

  catalogue: {
    title: 'Katalog',
    search: 'Suchen',
    searchPlaceholder: 'Name, Marke oder EAN',
    filters: 'Filter',
    category: 'Kategorie',
    allCategories: 'Alle Kategorien',
    minStars: 'Mindestens',
    anyStars: 'Egal',
    ratedByMe: 'Nur von mir bewertete',
    sort: 'Sortierung',
    order: 'Richtung',
    sortName: 'Name',
    sortCreated: 'Anlagedatum',
    sortUpdated: 'Zuletzt geändert',
    sortRating: 'Bewertung',
    orderAsc: 'aufsteigend',
    orderDesc: 'absteigend',
    resetFilters: 'Filter zurücksetzen',
    total: (count: number) => (count === 1 ? '1 Produkt' : `${count} Produkte`),
    empty: 'Der Katalog ist noch leer. Scanne das erste Produkt.',
    emptyFiltered: 'Zu dieser Suche gibt es nichts. Vielleicht mit weniger Filtern?',
    photoAlt: (name: string) => `Foto von ${name}`,
    noPhoto: 'Kein Foto',
  },

  /* ---------------------------------------------------------- own ratings */

  myRatings: {
    title: 'Meine Bewertungen',
    sortRated: 'Bewertungsdatum',
    sortStars: 'Sterne',
    sortName: 'Name',
    empty: 'Du hast noch nichts bewertet.',
    ratedAt: (date: string) => `Bewertet am ${date}`,
  },

  /* -------------------------------------------------------------- settings */

  settings: {
    title: 'Einstellungen',
    account: 'Konto',
    role: 'Rolle',
    roleAdmin: 'Administrator',
    roleUser: 'Nutzer',
    memberSince: (date: string) => `Dabei seit ${date}`,

    passwordTitle: 'Passwort ändern',
    passwordIntro: 'Nach der Änderung werden alle anderen Sitzungen abgemeldet.',
    passwordSubmit: 'Passwort ändern',
    passwordChanged: (revoked: number) =>
      revoked === 0
        ? 'Das Passwort wurde geändert.'
        : revoked === 1
          ? 'Das Passwort wurde geändert. Eine weitere Sitzung wurde abgemeldet.'
          : `Das Passwort wurde geändert. ${revoked} weitere Sitzungen wurden abgemeldet.`,
    passwordWrong: 'Das aktuelle Passwort stimmt nicht.',

    sessionsTitle: 'Angemeldete Geräte',
    sessionsIntro: 'Hier siehst du, wo dein Konto gerade angemeldet ist.',
    sessionCurrent: 'Dieses Gerät',
    sessionLastSeen: (date: string) => `Zuletzt aktiv ${date}`,
    sessionExpires: (date: string) => `Läuft ab am ${date}`,
    sessionRevoke: 'Gerät abmelden',
    /** Names the device, so a list of them does not read as five identical buttons. */
    sessionRevokeFor: (device: string) => `${device} abmelden`,
    sessionsEmpty: 'Keine weiteren Sitzungen.',
    unknownDevice: 'Unbekanntes Gerät',

    logoutTitle: 'Abmelden',
    logoutIntro: 'Meldet dieses Gerät ab. Andere Sitzungen bleiben bestehen.',

    adminTitle: 'Verwaltung',
    adminIntro: 'Nutzer und Einladungen verwalten.',
    toAdmin: 'Zur Verwaltung',
  },

  /* --------------------------------------------------------------- admin */

  admin: {
    title: 'Verwaltung',
    usersTitle: 'Nutzer',
    usersEmpty: 'Es gibt noch keine weiteren Nutzer.',
    userDisabled: 'Deaktiviert',
    userDisable: 'Deaktivieren',
    userEnable: 'Aktivieren',
    userMakeAdmin: 'Zum Administrator machen',
    userMakeUser: 'Zum Nutzer machen',
    userSelf: 'Du',
    userResetPassword: 'Passwort zurücksetzen',
    userResetSubmit: 'Neues Passwort setzen',
    userResetDone: 'Das Passwort wurde gesetzt und alle Sitzungen des Kontos beendet.',

    invitesTitle: 'Einladungen',
    invitesIntro: 'Ein Code gilt für genau eine Registrierung.',
    inviteCreate: 'Einladung erzeugen',
    inviteCreating: 'Wird erzeugt …',
    inviteNote: 'Notiz',
    inviteNoteHint: 'Für wen ist der Code? Nur für dich sichtbar.',
    inviteCopyLink: 'Link kopieren',
    inviteRevoke: 'Zurückziehen',
    invitesEmpty: 'Es gibt gerade keine Einladungen.',
    inviteExpires: (date: string) => `Gültig bis ${date}`,
    inviteUsedBy: (username: string) => `Eingelöst von ${username}`,
    inviteStatusOpen: 'Offen',
    inviteStatusUsed: 'Eingelöst',
    inviteStatusExpired: 'Abgelaufen',

    userNeedsPassword: 'Passwort fehlt',
    userResetLink: 'Passwort-Link erzeugen',
    userResetLinkPending: 'Wird erzeugt …',
    userResetLinkHint:
      'Der Link wird nur einmal angezeigt – gespeichert wird nur seine Prüfsumme. Diese App verschickt keine E-Mails, gib ihn also selbst weiter.',
    userResetLinkFor: (username: string) => `Passwort-Link für ${username}`,
    userResetLinkExpires: (date: string) => `Gültig bis ${date}`,
    userResetLinkCopy: 'Link kopieren',
    userLock: 'Passwort entziehen',
    userLockHint:
      'Das Konto lässt sich danach nur noch über einen Passwort-Link betreten. Alle Sitzungen werden beendet.',
    userLockConfirm: 'Wirklich entziehen?',

    trashTitle: 'Papierkorb',
    trashIntro:
      'Gelöschte Produkte liegen hier, bis sie zurückgeholt oder endgültig entfernt werden.',
    trashEmpty: 'Der Papierkorb ist leer.',
    trashDeletedAt: (date: string) => `Gelöscht am ${date}`,
    trashDeletedBy: (username: string) => `von ${username}`,
    trashContents: (ratings: number, photos: number) =>
      `${ratings === 1 ? '1 Bewertung' : `${ratings} Bewertungen`}, ` +
      `${photos === 1 ? '1 Foto' : `${photos} Fotos`}`,
    trashRestore: 'Zurückholen',
    trashPurge: 'Endgültig löschen',
    trashPurgeConfirm: 'Wirklich endgültig löschen?',
  },
} as const;

/**
 * Turns the machine readable part of an error response into a sentence.
 *
 * The server answers in English and writes for a log, not for a phone screen —
 * so nothing it says is shown as is. What is used is the status, the error code
 * and the `details` it carries: `field` says which input was at fault, and a few
 * errors add the number the user actually needs (the minimum password length,
 * the seconds until the next try).
 */
export function apiErrorText(
  status: number,
  code: string,
  details?: Record<string, unknown>,
): string {
  const field = typeof details?.field === 'string' ? details.field : undefined;

  if (code === 'network_error') return strings.errors.network;

  if (status === 400) {
    if (field === 'password' && typeof details?.minimum === 'number') {
      return strings.errors.passwordTooShort(details.minimum);
    }
    if (field === 'invite') return strings.errors.inviteInvalid;
    if (field === 'token') return strings.errors.resetLinkInvalid;
    if (field === 'ean') return strings.validation.ean;
    if (field === 'photo') {
      // Three ways an upload is refused, and each one has a different remedy:
      // take a smaller picture, use another format, or pick a file that really
      // is an image.
      if (typeof details?.maxFileSizeMb === 'number') {
        return strings.errors.tooLargeMb(details.maxFileSizeMb);
      }
      if (typeof details?.detected === 'string') return strings.errors.unsupportedImage;
      return strings.errors.photoUnreadable;
    }
    return strings.errors.invalidRequest;
  }

  if (status === 401) {
    // The one specific 401 the login route produces: an account that has no
    // password any more says so, because "wrong password" would be a dead end.
    if (details?.reason === 'password_reset_required') return strings.errors.passwordResetRequired;
    return strings.errors.unauthorized;
  }
  if (status === 403) return strings.errors.forbidden;
  if (status === 404) return strings.errors.notFound;

  if (status === 409) {
    if (field === 'username') return strings.errors.usernameTaken;
    if (field === 'ean') return strings.errors.eanTaken;
    return strings.errors.conflict;
  }

  if (status === 413) return strings.errors.tooLarge;

  if (status === 429) {
    const seconds =
      typeof details?.retryAfterSeconds === 'number' ? Math.ceil(details.retryAfterSeconds) : 60;
    return strings.errors.rateLimited(seconds);
  }

  if (status >= 500) return strings.errors.server;

  return strings.errors.unknown;
}
