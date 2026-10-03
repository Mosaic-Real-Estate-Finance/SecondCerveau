import { useCallback, useEffect, useState } from "react";
import { USERS_EMAILS, INTERNAL_DOMAINS } from "./config";
import { bodyReadable, currentUser, onItemChanged, readItem, supportsNaa, type MailContext } from "./office";
import { externals, fold, type Participant } from "./participants";

// The panel, about 320 px wide, one column, no horizontal scrolling.
//
// It is deliberately light even when Outlook is in dark theme: the Mosaic
// identity is a light surface, and a taskpane that inverts with the host reads
// as a different product.
//
// The ten states of specs/001-outlook-vers-notion/data-model.md §5 live in the
// `Stage` union below. The states that need the Notion routes — new
// conversation, existing note, up to date, sending, sent, error — are reached
// from `loadThread`, which arrives with phase 3.

type Stage =
  | { name: "outside" }
  | { name: "incompatible" }
  | { name: "loading" }
  | { name: "no-mail" }
  | { name: "protected" }
  | { name: "no-external" }
  | { name: "ready"; mail: MailContext; participants: Participant[] };

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div
    className="min-h-screen bg-white px-4 py-5 text-navy"
    // The host may set a dark colour scheme on the document; this keeps the
    // panel on its own, light, palette.
    style={{ colorScheme: "light" }}
  >
    <div className="mx-auto flex w-full max-w-[320px] flex-col gap-4">{children}</div>
  </div>
);

const Title = ({ children }: { children: React.ReactNode }) => (
  <h1 className="font-serif text-xl leading-snug">{children}</h1>
);

const Muted = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-[color:var(--muted)]">{children}</p>
);

export function Panel({ inOutlook }: { inOutlook: boolean }) {
  const [stage, setStage] = useState<Stage>(inOutlook ? { name: "loading" } : { name: "outside" });

  const load = useCallback(async () => {
    if (!inOutlook) return setStage({ name: "outside" });
    if (!supportsNaa()) return setStage({ name: "incompatible" });

    setStage({ name: "loading" });
    const mail = readItem();
    if (!mail || !mail.conversationId) return setStage({ name: "no-mail" });
    if (!(await bodyReadable())) return setStage({ name: "protected" });

    const me = currentUser();
    const participants = fold(mail.participants, INTERNAL_DOMAINS, [...USERS_EMAILS, me]);
    if (!externals(participants).length) return setStage({ name: "no-external" });

    setStage({ name: "ready", mail, participants });
  }, [inOutlook]);

  useEffect(() => {
    void load();
    // Pinned panel: the user moves to another mail and the whole context is
    // rebuilt. Once a contact draft can be in flight, this asks first.
    onItemChanged(() => void load());
  }, [load]);

  if (stage.name === "outside") {
    return (
      <Frame>
        <Title>Vers Notion</Title>
        <Muted>
          Ce panneau s'ouvre depuis Outlook, sur un mail en lecture. Ouvert dans un navigateur, il n'a aucun
          mail à lire.
        </Muted>
      </Frame>
    );
  }

  if (stage.name === "incompatible") {
    return (
      <Frame>
        <Title>Cette version d'Outlook est trop ancienne</Title>
        <Muted>
          La connexion sécurisée au compte Microsoft demande Outlook 2409 (build 18025.20000) ou plus récent
          pour un abonnement Microsoft 365. Mettez Outlook à jour, ou utilisez Outlook sur le web.
        </Muted>
      </Frame>
    );
  }

  if (stage.name === "loading") {
    return (
      <Frame>
        <Muted>Lecture de l'échange…</Muted>
      </Frame>
    );
  }

  if (stage.name === "no-mail") {
    return (
      <Frame>
        <Title>Aucun mail ouvert</Title>
        <Muted>Sélectionnez un mail pour le rattacher à un contact.</Muted>
      </Frame>
    );
  }

  if (stage.name === "protected") {
    return (
      <Frame>
        <Title>Contenu non lisible</Title>
        <Muted>
          Ce mail est protégé ou chiffré : le complément ne peut pas en lire le contenu, et n'envoie rien.
        </Muted>
      </Frame>
    );
  }

  if (stage.name === "no-external") {
    return (
      <Frame>
        <Title>Aucun interlocuteur à rattacher</Title>
        <Muted>
          Tous les participants de cet échange sont internes à Mosaic. La base de notes retrace les échanges
          avec les clients ; il n'y a rien à y classer ici.
        </Muted>
      </Frame>
    );
  }

  const outside = externals(stage.participants);
  return (
    <Frame>
      <Title>{stage.mail.subject || "Sans objet"}</Title>
      <Muted>
        {outside.length} interlocuteur{outside.length > 1 ? "s" : ""} externe{outside.length > 1 ? "s" : ""}
      </Muted>
      <ul className="flex flex-col gap-2">
        {outside.map((one) => (
          <li key={one.address} className="rounded-2xl bg-white-smoke px-3 py-2">
            <span className="block truncate text-sm font-medium">{one.name || one.address}</span>
            {one.name && <span className="block truncate text-xs text-[color:var(--muted)]">{one.address}</span>}
          </li>
        ))}
      </ul>
      <Muted>La reconnaissance des contacts et l'envoi arrivent avec les routes Notion.</Muted>
    </Frame>
  );
}
