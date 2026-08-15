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
    logout: 'Abmelden',
    optional: 'optional',
    toCatalogue: 'Zum Katalog',
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
  },

  errors: {
    network: 'Keine Verbindung zum Server. Bitte die Netzwerkverbindung prüfen.',
    unauthorized: 'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.',
    forbidden: 'Dafür fehlen die Rechte.',
    notFound: 'Das gibt es hier nicht (mehr).',
    conflict: 'Das gibt es schon.',
    invalidRequest: 'Die Eingabe passt nicht. Bitte prüfen.',
    tooLarge: 'Die Datei ist zu groß.',
    rateLimited: (seconds: number) =>
      `Zu viele Versuche. Bitte ${seconds} Sekunden warten und es dann noch einmal probieren.`,
    server: 'Der Server hat einen Fehler gemeldet. Bitte später erneut versuchen.',
    unknown: 'Unerwarteter Fehler.',
    passwordTooShort: (minimum: number) =>
      `Das Passwort muss mindestens ${minimum} Zeichen lang sein.`,
    usernameTaken: 'Dieser Benutzername ist schon vergeben.',
    inviteInvalid: 'Der Einladungscode ist ungültig, abgelaufen oder schon benutzt.',
    eanTaken: 'Zu dieser EAN gibt es schon ein Produkt.',
  },

  notFound: {
    title: 'Seite nicht gefunden',
    text: 'Diese Adresse gehört zu keiner Ansicht der App.',
  },

  /**
   * Screens whose function follows in M8. They exist already so that the
   * navigation is complete and every route leads somewhere.
   */
  placeholder: {
    note: 'Diese Ansicht entsteht mit Meilenstein M8.',
    catalogue: 'Hier stehen später die Produkte mit Suche, Filtern und Thumbnails.',
    scan: 'Hier öffnet sich später die Kamera mit dem Barcode-Scanner.',
    ratings: 'Hier stehen später die eigenen Bewertungen, sortierbar nach Datum, Sternen und Name.',
    settings: 'Hier lassen sich später das Passwort ändern und die eigenen Sitzungen verwalten.',
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
    if (field === 'ean') return strings.validation.ean;
    if (field === 'photo') return strings.errors.tooLarge;
    return strings.errors.invalidRequest;
  }

  if (status === 401) return strings.errors.unauthorized;
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
