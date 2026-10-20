import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = await readFile(`${root}/app/operating-system.tsx`, "utf8");

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `No se encontró ${start}`);
  assert.notEqual(to, -1, `No se encontró ${end}`);
  return source.slice(from, to);
}

test("uses the authenticated Supabase profile as the only portal-role source", () => {
  const resolver = between("function resolvePortalRole(", "function isAdministrativeRole(");
  assert.match(resolver, /role === "owner" \|\| role === "admin"\) return "Dirección"/);
  assert.match(resolver, /role === "editor"\) return "Editor"/);
  assert.match(resolver, /role === "client"\) return "Cliente"/);
  assert.match(resolver, /return null/);
  assert.match(source, /\.from\("profiles"\)[\s\S]*?\.eq\("id", user\.id\)[\s\S]*?\.single\(\)/);
  assert.match(source, /const authenticatedRole = resolvePortalRole\(profile\.role\)/);
  assert.match(source, /const admin = isAdministrativeRole\(profile\.role\)/);
  assert.doesNotMatch(source, /FOUNDER_EMAIL|\bportalRole\b/);
  assert.doesNotMatch(source, /=== DEFAULT_LOGIN_EMAIL/);
});

test("administrative preview is local, operational, and never changes the authenticated role", () => {
  assert.match(source, /type AdminPreviewRole = Exclude<PortalRole, "Dirección"> \| null/);
  assert.match(source, /const \[previewRole, setPreviewRole\] = React\.useState<AdminPreviewRole>\(null\)/);
  assert.match(source, /const isPreviewing = admin && previewRole !== null/);
  assert.match(source, /const displayedRole: PortalRole = isPreviewing \? previewRole : authenticatedRole/);
  assert.match(source, /Vista administrativa operativa/);
  assert.match(source, /Previsualizar Editor/);
  assert.match(source, /Previsualizar Cliente/);
  assert.match(source, /const blockPreviewMutation = React\.useCallback\(\(\) => false, \[\]\)/);
  assert.doesNotMatch(source, /localStorage\.setItem\("negodigi-(?:preview|portal-role)/);
  assert.doesNotMatch(source, /sessionStorage\.setItem\("negodigi-(?:preview|portal-role)/);
});

test("editor-preview actions carry the selected editor and an administrator audit trail", () => {
  assert.match(source, /acting_as_user_id: previewRole === "Editor" \? previewSubject\?\.userId \|\| null : null/);
  assert.match(source, /recordPreviewAction\("submit_delivery_as_editor"/);
  assert.match(source, /recordPreviewAction\("respond_correction_as_editor"/);
  assert.match(source, /recordPreviewAction\("replace_video_version_as_editor"/);
  assert.match(source, /recordPreviewAction\("set_editor_presence_as_editor"/);
  assert.match(source, /source: "admin_preview"/);
});

test("never degrades an unresolved authenticated role into the client portal", () => {
  assert.match(source, /setAccessError\(\n?\s*"Tu cuenta existe, pero aún no tiene un rol autorizado en NegoDigi\./);
  assert.match(source, /setAccessError\("Tu cuenta tiene un rol no reconocido\. El acceso se ha bloqueado por seguridad\."\)/);
  assert.match(source, /return <AccessBlocked message=\{accessError\}/);
  assert.match(source, /No se pudo resolver tu rol/);
  assert.match(source, /setAccessError\(storedSession\.session && authError \?/);
});

test("refreshes the auth session before using a server-validated user", () => {
  const refresh = between("const runRefresh = React.useCallback(async (scopes:", "React.useEffect(() => {\n    const initialRefresh");
  const storedSession = refresh.indexOf("supabase.auth.getSession()");
  const refreshSession = refresh.indexOf("supabase.auth.refreshSession()");
  const verifiedUser = refresh.indexOf("supabase.auth.getUser()");
  assert.ok(storedSession >= 0, "La sesión debe inspeccionarse al cargar");
  assert.ok(refreshSession > storedSession, "La sesión próxima a vencer debe renovarse");
  assert.ok(verifiedUser > refreshSession, "La identidad debe verificarse después de renovar");
  assert.match(source, /onAuthStateChange\(\(event, session\) => \{[\s\S]*?window\.setTimeout\(\(\) => void refresh\(\), 0\)/);
  assert.match(source, /sessionIdentity\.current === nextIdentity\) return/);
});

test("removes obsolete preview state without deleting the Supabase session", () => {
  assert.match(source, /LEGACY_PREVIEW_STORAGE_KEYS/);
  assert.match(source, /window\.localStorage\.removeItem\(key\)/);
  assert.match(source, /window\.sessionStorage\.removeItem\(key\)/);
  assert.doesNotMatch(source, /localStorage\.clear\(|sessionStorage\.clear\(/);
});
