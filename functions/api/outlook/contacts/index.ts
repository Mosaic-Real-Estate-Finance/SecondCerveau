import { ContactError, createContact, emailColumn, type NewContact } from "../../../_lib/contact";
import { fail, guard, json, props, type Handler } from "../../../_lib/notion";

// Creating a contact from the Outlook panel.
//
// Same creation as the dictation's, through the same shared function, with one
// difference that matters: here the address is required. A contact created
// without it would be invisible to every later recognition — the next mail
// from the same person would offer to create them a second time — so the route
// refuses rather than write a fiche that cannot be found again.
//
// /api/contacts is untouched: the dictation keeps creating contacts without an
// address, because its screens never ask for one.

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;

  const body = (await request.json().catch(() => ({}))) as NewContact;
  if (!body.name?.trim() || !body.email?.trim()) {
    return json({ error: "Nom et adresse mail requis" }, 400);
  }
  if (body.companyId && body.newCompany?.name?.trim()) {
    return json({ error: "Choisissez une société existante ou donnez-en une nouvelle" }, 400);
  }

  try {
    // Said out loud before anything is written: creating the contact and then
    // dropping its address is the one outcome worth failing for.
    if (!(await emailColumn(env))) {
      return json({ error: `La base Contacts n'a pas de propriété « ${props(env).contactEmail} »` }, 500);
    }
    const contact = await createContact(env, body);
    return json({ id: contact.id, name: contact.name, company: contact.company }, 201);
  } catch (error) {
    if (error instanceof ContactError) return json({ error: error.message }, 400);
    return fail(error);
  }
};
