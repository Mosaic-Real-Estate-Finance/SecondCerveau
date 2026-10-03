// The people allowed to use the app, and the Notion account each note is
// written on behalf of (the "Auteur" property of the notes base).
//
// The ids come from GET /v1/users on this workspace. To refresh them:
//   curl -s https://api.notion.com/v1/users -H "Authorization: Bearer $NOTION_TOKEN" \
//        -H "Notion-Version: 2026-03-11" | jq '.results[] | {name, id, email: .person.email}'

export type User = { email: string; firstName: string; notionUserId: string };

export const USERS: User[] = [
  { email: "ob@mosaicfin.com", firstName: "Oscar", notionUserId: "fab25539-5e5f-4766-af3a-14397eda089f" },
  { email: "pb@mosaicfin.com", firstName: "Philippe", notionUserId: "96b0616b-21fa-47e3-9b20-38784525a617" },
  { email: "xn@mosaicfin.com", firstName: "Xavier", notionUserId: "0f80cf39-fb27-42dc-8943-110b2426aa83" },
  { email: "theo@gouman.fr", firstName: "Théo", notionUserId: "c9b01750-8bda-47cf-b4b8-56b12eaf5333" },
];

export const findUser = (email: string | null | undefined): User | null => {
  const wanted = (email ?? "").trim().toLowerCase();
  return USERS.find((user) => user.email === wanted) ?? null;
};
