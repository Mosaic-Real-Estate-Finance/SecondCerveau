import { useCallback, useEffect, useRef, useState } from "react";
import { PrimaryButton, TextButton } from "@/components/screen";
import { Shimmer } from "@/components/shimmer";
import { SuccessCheck } from "@/components/success-check";
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
import { NotionButton } from "./NotionButton";
import { openNotes } from "./notion-link";
import { INTERNAL_DOMAINS, USERS_EMAILS } from "./config";
import { fetchThread, GraphError } from "./graph";
import { draftReady, newDraft, ParticipantForm, type Draft } from "./ParticipantForm";
import {
  awaitItem,
  bodyReadable,
  canClose,
  closePanel,
  currentUser,
  inMailbox,
  onItemChanged,
  supportsNaa,
  type MailContext,
} from "./office";
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
  | { name: "sent"; url: string; added: number; created: boolean };

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

/**
 * Some failures carry a sentence the reader can act on; these three carry the
 * fact that something failed, which they already know from the title. Saying
 * "Erreur inattendue" twice over is not more information.
 */
const EMPTY = ["Erreur inattendue", "Chargement impossible.", "Envoi impossible."];
const readable = (message: string) => (EMPTY.includes(message.trim()) ? "Réessaye dans quelques instants." : message);

/** Plural mark, for the many counts this panel reports. */
const s_ = (count: number) => (count > 1 ? "s" : "");

/**
 * A screen that closes the panel once it has nothing left to say.
 *
 * Only where the host allows it: `closeContainer` does not exist everywhere,
 * and a button that does nothing is worse than no button.
 */
const CloseButton = () =>
  canClose() ? (
    <TextButton className="w-full text-center" onClick={closePanel}>
      Fermer
    </TextButton>
  ) : null;

/**
 * Nothing to do, and nothing else worth showing.
 *
 * The subject, the counter, the contacts all describe work that is already
 * done; leaving them up invites a second press on a button that would change
 * nothing. One sentence and one way in.
 */
const AlreadyThere = ({ url }: { url: string }) => (
  <Frame>
    <div className="flex justify-center pt-2">
      <SuccessCheck show />
    </div>
    <Title>Cette note est déjà enregistrée dans Notion</Title>
    <NotionButton label="Ouvrir la note" url={url} />
  </Frame>
);

/** The end of a successful send: the check, a word, the way into Notion. */
function Done({ title, url, children }: { title: string; url: string; children?: React.ReactNode }) {
  return (
    <Frame>
      <div className="flex justify-center pt-2">
        <SuccessCheck show />
      </div>
      <Title>{title}</Title>
      {children}
      <NotionButton label="Ouvrir dans Notion" url={url} />
      <CloseButton />
    </Frame>
  );
}

function Said({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Frame>
      <Title>{title}</Title>
      {children && <Muted>{children}</Muted>}
    </Frame>
  );
}

export function Panel({ inOutlook }: { inOutlook: boolean }) {
  const [stage, setStage] = useState<Stage>(inOutlook ? { name: "loading", read: 0 } : { name: "outside" });
  // Contacts already created survive a failed send: a retry must not create
  // them a second time, and the route has no unicity key to lean on.
  const created = useRef(new Map<string, MatchedContact>());
  const drafting = useRef(false);

  const load = useCallback(async () => {
    // Order matters. office.js loads in any browser tab, so "no mailbox" has
    // to be ruled out before "mailbox too old" — otherwise opening the page to
    // look at the layout reports that Outlook needs updating.
    if (!inOutlook || !inMailbox()) return setStage({ name: "outside" });
    if (!supportsNaa()) return setStage({ name: "incompatible" });
    if (!configured()) return setStage({ name: "unconfigured" });

    setStage({ name: "loading", read: 0 });
    created.current.clear();

    // Waited for, not read once: see awaitItem in ./office.
    const mail = await awaitItem();
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

      // `templateTimedOut` is deliberately not shown. It only ever meant the
      // Notion template was slow and the blocks landed above it — a cosmetic
      // ordering the reader cannot act on, reported as if it were a defect.
      setStage({ name: "sent", url: written.url, added: written.messagesAdded, created: !data.note });
    } catch (error) {
      const api = error as ApiError;
      // 409: someone enriched the note in between. Reloading is the only safe
      // move; writing over their mark would make the next enrichment skip
      // their messages.
      if (api.status === 409) {
        setStage({ name: "failed", message: "La note a été enrichie entre-temps. Recharge.", retry: true });
        return;
      }
      setStage({ name: "failed", message: api.message ?? "Envoi impossible.", retry: api.retry ?? true });
    }
  }

  // ---- the states that need nothing ----------------------------------------

  if (stage.name === "outside") {
    return (
      <Said title="Vers Notion">
        Ce panneau s'ouvre depuis Outlook, sur un mail en lecture. Ouvert directement dans un navigateur, il n'a
        aucune boîte mail à lire — c'est normal, et ce n'est pas une erreur.
      </Said>
    );
  }
  if (stage.name === "incompatible") {
    return (
      <Said title="Cette version d'Outlook est trop ancienne">
        La connexion sécurisée au compte Microsoft demande Outlook 2409 ou plus récent pour un abonnement
        Microsoft 365. Mets Outlook à jour, ou utilise Outlook sur le web.
      </Said>
    );
  }
  if (stage.name === "unconfigured") {
    return (
      <Said title="Théo n'a pas encore fini le travail.">
        L'application n'est pas correctement configurée côté serveur. Si tu penses qu'il s'agit d'une erreur, écris
        à Théo.
      </Said>
    );
  }
  if (stage.name === "no-mail") {
    // Reachable, and worth more than one line. Outlook on the web gives a
    // Message Read add-in no item context from the top ribbon, and tears the
    // taskpane down itself — nothing here closes it. Saying where the add-in
    // does open is the only thing that helps. See research.md G-5.
    return (
      <Frame>
        <Title>Sélectionne un message pour l'envoyer vers Notion</Title>
        <Muted>
          Sur Outlook sur le web, le complément s'ouvre depuis le bouton d'applications de l'en-tête d'un message.
          Ouvert depuis le ruban du haut, il n'a aucun message à lire et Outlook referme le panneau.
        </Muted>
        <PrimaryButton onClick={() => void load()}>Réessayer</PrimaryButton>
      </Frame>
    );
  }
  if (stage.name === "protected") {
    return (
      <Frame>
        <Title>Nous ne pouvons pas extraire ce mail</Title>
        <Muted>Microsoft protège ce mail et restreint son extraction, nous ne pouvons pas le récupérer.</Muted>
        <Muted>La solution ? Créer cette note à la main en copiant / collant le contenu.</Muted>
        {/* The one screen with nothing to write: the least it can do is open
            the place where the work has to happen instead. */}
        <NotionButton label="Ouvrir Notion" onClick={openNotes} />
      </Frame>
    );
  }
  if (stage.name === "no-external") {
    return (
      <Said title="Les échanges internes ne sont pas pris en charge">
        L'outil capture uniquement les mails avec des interlocuteurs externes. Écris à Théo si tu souhaites aussi
        enregistrer tes échanges avec les collaborateurs de Mosaic.
      </Said>
    );
  }
  if (stage.name === "loading") {
    return (
      <Frame>
        <Title>
          <Shimmer>On récupère l'échange…</Shimmer>
        </Title>
        {stage.read > 0 && (
          <Muted>{`${stage.read} message${s_(stage.read)} identifié${s_(stage.read)}`}</Muted>
        )}
      </Frame>
    );
  }
  if (stage.name === "failed") {
    return (
      <Frame>
        <Title>On a eu un petit problème</Title>
        <Muted>{readable(stage.message)}</Muted>
        {stage.retry && <PrimaryButton onClick={() => void load()}>Réessayer</PrimaryButton>}
      </Frame>
    );
  }
  if (stage.name === "sent") {
    // Nothing was added: whatever the user pressed, the state of the world is
    // "already in Notion", and that is the one thing worth saying. There is no
    // separate "nothing to add" screen any more — it only ever reported on the
    // request rather than on the note.
    if (!stage.added) return <AlreadyThere url={stage.url} />;
    return stage.created ? (
      <Done title="Enregistré dans Notion !" url={stage.url}>
        <Muted>{`${stage.added} message${s_(stage.added)} ${stage.added > 1 ? "ont" : "a"} été centralisé${s_(stage.added)}, Notion AI s'occupe du résumé.`}</Muted>
      </Done>
    ) : (
      <Done title="La note a été enrichie" url={stage.url} />
    );
  }

  // ---- the thread is in hand ----------------------------------------------

  const data = stage.data;
  const sending = stage.name === "sending";

  const total = data.messages.length;
  const already = total - data.fresh;
  const enriching = Boolean(data.note);

  // C2 from the ready screen too: a note with nothing new to add is finished
  // business, whether that is discovered before or after a send.
  if (enriching && data.fresh === 0) return <AlreadyThere url={data.note!.url} />;

  const incomplete = data.rows.some((row) => row.selected && !row.match && !draftReady(row.draft ?? newDraft("", "")));
  const nobody = !data.rows.some((row) => row.selected);

  // Written out rather than assembled: "nouveau" does not take the plural
  // mark the others do, and `nouveau${s}` quietly produced "nouveaus".
  const heading = !enriching
    ? "On l'ajoute dans Notion ?"
    : data.fresh > 1
      ? `${data.fresh} nouveaux messages seront ajoutés`
      : "1 nouveau message sera ajouté";

  // The subject used to be the title. It is already at the top of the mail the
  // reader is looking at, and it said nothing about what the button would do.
  const standfirst = !enriching
    ? `${total} mail${s_(total)} ${total > 1 ? "seront centralisés" : "sera centralisé"} dans la note`
    : already === 0
      ? `Aucun message n'avait encore été enregistré, les ${data.fresh} seront ajoutés.`
      : `${already > 1 ? `Les ${already} premiers mails ont déjà été enregistrés` : "Le premier mail a déjà été enregistré"}, ${
          data.fresh > 1 ? `les ${data.fresh} nouveaux seront ajoutés en complément` : "le nouveau sera ajouté en complément"
        }.`;

  return (
    <Frame>
      <div className="t-fade-in flex flex-col gap-4">
        <Title>{heading}</Title>
        <Muted>{standfirst}</Muted>

        {data.ambiguous.length > 0 && (
          <Muted>
            Plusieurs contacts portent {data.ambiguous.join(", ")} : le premier a été retenu, à corriger dans Notion.
          </Muted>
        )}

        {/* The outer box names what the cards inside are for. Without it the
            list reads as a selection of people with no stated consequence. */}
        <div className="rounded-2xl border border-[color:var(--color-white-smoke)] bg-white p-3">
          <p className="mb-2.5 flex items-center gap-2 text-xs text-[color:var(--muted)]">
            <img src="/outlook/contact.svg" alt="" width="16" height="16" className="shrink-0" />
            Cette note sera liée à…
          </p>
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
                        <span
                          className={cn(
                            "mt-1 inline-block text-2xs",
                            row.selected ? "text-navy" : "text-[color:var(--muted)]",
                          )}
                        >
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
        </div>

        <PrimaryButton disabled={sending || nobody || incomplete} onClick={() => void send(data)}>
          {sending ? stage.step : enriching ? "Enrichir la note" : "Créer la note"}
        </PrimaryButton>
        {enriching && <NotionButton label="Ouvrir dans Notion" url={data.note!.url} />}
        {nobody && <Muted>Coche au moins un interlocuteur.</Muted>}
        {!nobody && incomplete && <Muted>Complète les fiches cochées avant d'envoyer.</Muted>}
      </div>
    </Frame>
  );
}
