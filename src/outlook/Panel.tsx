import { useCallback, useEffect, useRef, useState } from "react";
import { dialOf } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  ApiError,
  createContact,
  createNote,
  enrichNote,
  findNote,
  listCompanies,
  matchContacts,
  setFallbackEmail,
  setTokenProvider,
  type Company,
  type ExistingNote,
  type MatchedContact,
  type ThreadMessage,
} from "./api";
import { apiToken, AuthError, configured, graphToken } from "./auth";
import { INTERNAL_DOMAINS, USERS_EMAILS } from "./config";
import { fetchThread, GraphError } from "./graph";
import { draftReady, newDraft, ParticipantForm, type Draft } from "./ParticipantForm";
import { bodyReadable, currentUser, onItemChanged, readItem, supportsNaa, type MailContext } from "./office";
import { externals, fold, type Participant } from "./participants";

// The panel, about 320 px wide, one column, no horizontal scrolling.
//
// Deliberately light even when Outlook is in dark theme: the Mosaic identity
// is a light surface, and a taskpane that inverts with its host reads as a
// different product.
//
// The states below are the ones in
// specs/001-outlook-vers-notion/data-model.md §5. The ones that can be reached
// without reading anything — no mail, protected, nobody external — are settled
// before a single request goes out.

type Row = {
  participant: Participant;
  match: MatchedContact | null;
  selected: boolean;
  draft: Draft | null;
};

type Loaded = {
  mail: MailContext;
  rows: Row[];
  messages: ThreadMessage[];
  note: ExistingNote | null;
  fresh: number;
  companies: Company[];
  typeOptions: string[];
  ambiguous: string[];
};

type Stage =
  | { name: "outside" }
  | { name: "incompatible" }
  | { name: "unconfigured" }
  | { name: "loading"; read: number }
  | { name: "no-mail" }
  | { name: "protected" }
  | { name: "no-external" }
  | { name: "failed"; message: string; retry: boolean }
  | { name: "ready"; data: Loaded }
  | { name: "sending"; data: Loaded; step: string }
  | { name: "sent"; url: string; added: number; partial: boolean };

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-white px-4 py-5 text-navy" style={{ colorScheme: "light" }}>
    <div className="mx-auto flex w-full max-w-[320px] flex-col gap-4">{children}</div>
  </div>
);

const Title = ({ children }: { children: React.ReactNode }) => (
  <h1 className="font-serif text-xl leading-snug">{children}</h1>
);

const Muted = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-[color:var(--muted)]">{children}</p>
);

function Said({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Frame>
      <Title>{title}</Title>
      {children && <Muted>{children}</Muted>}
    </Frame>
  );
}

const MONTHS = "janvier février mars avril mai juin juillet août septembre octobre novembre décembre".split(" ");
const day = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getDate()} ${MONTHS[date.getMonth()]}`;
};

/** "du 3 au 17 septembre", or a single date when the thread is one day old. */
function span(messages: ThreadMessage[]) {
  const first = day(messages[0].receivedAt);
  const last = day(messages[messages.length - 1].receivedAt);
  return first === last ? `le ${first}` : `du ${first} au ${last}`;
}

export function Panel({ inOutlook }: { inOutlook: boolean }) {
  const [stage, setStage] = useState<Stage>(inOutlook ? { name: "loading", read: 0 } : { name: "outside" });
  // Contacts already created survive a failed send: a retry must not create
  // them a second time, and the route has no unicity key to lean on.
  const created = useRef(new Map<string, MatchedContact>());
  const drafting = useRef(false);

  const load = useCallback(async () => {
    if (!inOutlook) return setStage({ name: "outside" });
    if (!supportsNaa()) return setStage({ name: "incompatible" });
    if (!configured()) return setStage({ name: "unconfigured" });

    setStage({ name: "loading", read: 0 });
    created.current.clear();

    const mail = readItem();
    if (!mail?.conversationId) return setStage({ name: "no-mail" });
    if (!(await bodyReadable())) return setStage({ name: "protected" });

    const participants = fold(mail.participants, INTERNAL_DOMAINS, [...USERS_EMAILS, currentUser()]);
    const outside = externals(participants);
    if (!outside.length) return setStage({ name: "no-external" });

    try {
      // Both tokens first, in series. The very first acquisition can open the
      // host's consent window, and three parallel requests each wanting a
      // token would ask for it more than once — which reads as a bug and gets
      // dismissed.
      const graph = await graphToken();
      await apiToken();

      // Then the reads, together: the thread, the note and the contacts are
      // independent, so the panel waits on the slowest rather than on the sum.
      const [messages, note, match, companies] = await Promise.all([
        fetchThread(graph, mail.conversationId, (read) => setStage({ name: "loading", read })),
        findNote(mail.conversationId),
        matchContacts(outside.map((one) => one.address)),
        listCompanies().catch(() => ({ companies: [], typeOptions: [] })),
      ]);

      const rows: Row[] = outside.map((participant) => {
        const match_ = match.matched[participant.address] ?? null;
        return { participant, match: match_, selected: true, draft: match_ ? null : newDraft(participant.name, participant.address) };
      });

      // Everything after the mark the note carries. No mark — a note from
      // before this feature — and the whole thread counts as new: a visible
      // duplicate in the body beats a message that is never written.
      const at = note?.lastMessageId
        ? messages.findIndex((message) => message.id === note.lastMessageId)
        : -1;
      const fresh = note ? messages.length - (at + 1) : messages.length;

      setStage({
        name: "ready",
        data: { mail, rows, messages, note, fresh, companies: companies.companies, typeOptions: match.typeOptions, ambiguous: match.ambiguous ?? [] },
      });
    } catch (error) {
      if (error instanceof AuthError) return setStage({ name: "failed", message: error.message, retry: true });
      if (error instanceof GraphError) return setStage({ name: "failed", message: error.message, retry: error.status >= 500 });
      const api = error as ApiError;
      setStage({ name: "failed", message: api.message ?? "Chargement impossible.", retry: api.retry ?? true });
    }
  }, [inOutlook]);

  useEffect(() => {
    if (inOutlook) {
      if (configured()) setTokenProvider(apiToken);
      else setFallbackEmail(currentUser());
    }
    void load();

    // Pinned panel: the user moves to another mail and the whole context is
    // rebuilt. A draft in progress is worth a question first — it is typing
    // nobody wants to do twice.
    onItemChanged(() => {
      if (drafting.current && !window.confirm("Une fiche contact est en cours. Changer de mail l'abandonnera.")) {
        return;
      }
      void load();
    });
  }, [inOutlook, load]);

  // Read by the ItemChanged handler, which lives outside React's render and
  // cannot look at state. Written in an effect, never during a render.
  useEffect(() => {
    const rows = stage.name === "ready" || stage.name === "sending" ? stage.data.rows : [];
    drafting.current = rows.some(
      (row) => row.draft && (row.draft.name.trim() || row.draft.role.trim() || row.draft.phone.number.trim()),
    );
  }, [stage]);

  const patch = (data: Loaded, rows: Row[]) => setStage({ name: "ready", data: { ...data, rows } });

  async function send(data: Loaded) {
    const chosen = data.rows.filter((row) => row.selected);
    try {
      // Contacts first, in series, keeping each id: a retry resumes where it
      // stopped instead of creating a second fiche for the same person.
      const ids: string[] = [];
      for (const row of chosen) {
        if (row.match) {
          ids.push(row.match.id);
          continue;
        }
        const held = created.current.get(row.participant.address);
        if (held) {
          ids.push(held.id);
          continue;
        }
        if (!row.draft || !draftReady(row.draft)) continue;
        setStage({ name: "sending", data, step: `Création de ${row.draft.name.trim()}…` });
        const contact = await createContact({
          name: row.draft.name.trim(),
          email: row.draft.email.trim(),
          role: row.draft.role.trim() || undefined,
          types: row.draft.types.length ? row.draft.types : undefined,
          phones: row.draft.phone.number.trim()
            ? [{ ...row.draft.phone, dial: dialOf(row.draft.phone.country) }]
            : undefined,
          companyId: row.draft.companyId,
          newCompany: !row.draft.companyId && row.draft.companyName ? { name: row.draft.companyName } : undefined,
        });
        created.current.set(row.participant.address, contact);
        ids.push(contact.id);
      }

      if (!ids.length) {
        return setStage({ name: "failed", message: "Aucun interlocuteur à rattacher.", retry: false });
      }

      setStage({ name: "sending", data, step: data.note ? "Enrichissement de la note…" : "Création de la note…" });
      const written = data.note
        ? await enrichNote({
            noteId: data.note.id,
            conversationId: data.mail.conversationId,
            sinceMessageId: data.note.lastMessageId,
            contactIds: ids,
            messages: data.messages,
          })
        : await createNote({
            conversationId: data.mail.conversationId,
            contactIds: ids,
            messages: data.messages,
          });

      setStage({ name: "sent", url: written.url, added: written.messagesAdded, partial: Boolean(written.templateTimedOut) });
    } catch (error) {
      const api = error as ApiError;
      // 409: someone enriched the note in between. Reloading is the only safe
      // move; writing over their mark would make the next enrichment skip
      // their messages.
      if (api.status === 409) {
        setStage({ name: "failed", message: "La note a été enrichie entre-temps. Rechargez.", retry: true });
        return;
      }
      setStage({
        name: "failed",
        message: api.noteUrl
          ? "La note a été créée mais les messages n'ont pas pu y être ajoutés. Ouvrez-la pour vérifier."
          : (api.message ?? "Envoi impossible."),
        retry: api.retry ?? true,
      });
    }
  }

  // ---- the states that need nothing ----------------------------------------

  if (stage.name === "outside") {
    return (
      <Said title="Vers Notion">
        Ce panneau s'ouvre depuis Outlook, sur un mail en lecture. Ouvert dans un navigateur, il n'a aucun mail à
        lire.
      </Said>
    );
  }
  if (stage.name === "incompatible") {
    return (
      <Said title="Cette version d'Outlook est trop ancienne">
        La connexion sécurisée au compte Microsoft demande Outlook 2409 (build 18025.20000) ou plus récent pour un
        abonnement Microsoft 365. Mettez Outlook à jour, ou utilisez Outlook sur le web.
      </Said>
    );
  }
  if (stage.name === "unconfigured") {
    return (
      <Said title="Complément non configuré">
        L'application Microsoft n'est pas renseignée côté serveur. Le fil ne peut pas être lu sans elle.
      </Said>
    );
  }
  if (stage.name === "no-mail") {
    return <Said title="Aucun mail ouvert">Sélectionnez un mail pour le rattacher à un contact.</Said>;
  }
  if (stage.name === "protected") {
    return (
      <Said title="Contenu non lisible">
        Ce mail est protégé ou chiffré : le complément ne peut pas en lire le contenu, et n'envoie rien.
      </Said>
    );
  }
  if (stage.name === "no-external") {
    return (
      <Said title="Aucun interlocuteur à rattacher">
        Tous les participants de cet échange sont internes à Mosaic. La base de notes retrace les échanges avec les
        clients ; il n'y a rien à y classer ici.
      </Said>
    );
  }
  if (stage.name === "loading") {
    return (
      <Frame>
        <Muted>{stage.read ? `Lecture de l'échange… ${stage.read} messages` : "Lecture de l'échange…"}</Muted>
      </Frame>
    );
  }
  if (stage.name === "failed") {
    return (
      <Frame>
        <Title>Ça n'a pas marché</Title>
        <Muted>{stage.message}</Muted>
        {stage.retry && (
          <button type="button" className="send-button rounded-[18px] px-4 py-3 text-sm" onClick={() => void load()}>
            Réessayer
          </button>
        )}
      </Frame>
    );
  }
  if (stage.name === "sent") {
    return (
      <Frame>
        <Title>{stage.added ? "Note à jour" : "Rien à ajouter"}</Title>
        <Muted>
          {stage.added
            ? `${stage.added} message${stage.added > 1 ? "s" : ""} enregistré${stage.added > 1 ? "s" : ""}. La réécriture par Notion AI prend quelques secondes.`
            : "La note contenait déjà tout le fil."}
        </Muted>
        {stage.partial && <Muted>L'ordre des blocs peut être inhabituel : le modèle Notion tardait.</Muted>}
        <a href={stage.url} target="_blank" rel="noreferrer" className="text-sm underline">
          Ouvrir dans Notion
        </a>
      </Frame>
    );
  }

  // ---- the thread is in hand ----------------------------------------------

  const data = stage.data;
  const sending = stage.name === "sending";

  const upToDate = Boolean(data.note) && data.fresh === 0;
  const incomplete = data.rows.some((row) => row.selected && !row.match && !draftReady(row.draft ?? newDraft("", "")));
  const nobody = !data.rows.some((row) => row.selected);

  return (
    <Frame>
      <Title>{data.mail.subject || "Sans objet"}</Title>
      <Muted>
        {data.messages.length} message{data.messages.length > 1 ? "s" : ""}, {span(data.messages)}
      </Muted>

      {data.note && (
        <div className="rounded-xl bg-white-smoke px-3 py-2.5">
          <p className="text-sm font-medium">
            {upToDate
              ? "Note à jour"
              : `Note existante, ${data.fresh} nouveau${data.fresh > 1 ? "x" : ""} message${data.fresh > 1 ? "s" : ""}`}
          </p>
          <a href={data.note.url} target="_blank" rel="noreferrer" className="text-2xs underline text-[color:var(--muted)]">
            Ouvrir dans Notion
          </a>
        </div>
      )}

      {data.ambiguous.length > 0 && (
        <Muted>
          Plusieurs contacts portent {data.ambiguous.join(", ")} : le premier a été retenu, à corriger dans Notion.
        </Muted>
      )}

      <ul className="flex flex-col gap-2">
        {data.rows.map((row, index) => {
          const toggle = () =>
            patch(
              data,
              data.rows.map((other, at) => (at === index ? { ...other, selected: !other.selected } : other)),
            );
          const onDraft = (draft: Draft) =>
            patch(
              data,
              data.rows.map((other, at) => (at === index ? { ...other, draft } : other)),
            );
          return (
            <li key={row.participant.address} className="rounded-xl bg-white-smoke px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={toggle}
                  disabled={sending}
                  className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--color-navy)]"
                  aria-label={`Rattacher ${row.participant.name || row.participant.address}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {row.match?.name || row.participant.name || row.participant.address}
                  </span>
                  <span className="block truncate text-2xs text-[color:var(--muted)]">
                    {row.match
                      ? [row.match.company, row.participant.address].filter(Boolean).join(" · ")
                      : row.participant.address}
                  </span>
                  {!row.match && (
                    <span className={cn("mt-1 inline-block text-2xs", row.selected ? "text-navy" : "text-[color:var(--muted)]")}>
                      Nouveau contact
                    </span>
                  )}
                </span>
              </div>
              {!row.match && row.selected && !sending && row.draft && (
                <ParticipantForm
                  draft={row.draft}
                  onChange={onDraft}
                  companies={data.companies}
                  typeOptions={data.typeOptions}
                />
              )}
            </li>
          );
        })}
      </ul>

      {upToDate ? (
        <Muted>Aucun message nouveau depuis le dernier envoi.</Muted>
      ) : (
        <>
          <button
            type="button"
            className="send-button rounded-[18px] px-4 py-3 text-sm disabled:opacity-50"
            disabled={sending || nobody || incomplete}
            onClick={() => void send(data)}
          >
            {sending ? stage.step : data.note ? "Enrichir la note" : "Créer la note"}
          </button>
          {nobody && <Muted>Cochez au moins un interlocuteur.</Muted>}
          {!nobody && incomplete && <Muted>Complétez les fiches cochées avant d'envoyer.</Muted>}
        </>
      )}
    </Frame>
  );
}
