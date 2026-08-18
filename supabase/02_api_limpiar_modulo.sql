-- ═══════════════════════════════════════════════════════════════════════
--  OLO — api_limpiar_modulo
--
--  Borra todos los datos de un módulo en un snapshot dado,
--  sin tocar los demás módulos ni crear un snapshot nuevo.
--  Las filas de sku_mes y cluster_mes se eliminan en cascada.
--
--  Uso: ejecutar en el SQL Editor de Supabase.
--  (Solo necesita correrse una vez; es idempotente.)
-- ═══════════════════════════════════════════════════════════════════════

create or replace function api_limpiar_modulo(
  p_snapshot_id bigint,
  p_modulo      text
) returns void
language plpgsql security definer as $$
begin
  -- sku_mes se borra en cascada desde sku_modulo
  delete from sku_modulo
  where snapshot_id = p_snapshot_id
    and modulo      = p_modulo;

  -- cluster_mes se borra en cascada desde cluster_modulo
  delete from cluster_modulo
  where snapshot_id = p_snapshot_id
    and modulo      = p_modulo;
end $$;

-- Solo service_role puede ejecutar (la anon key no tiene permiso)
revoke execute on function api_limpiar_modulo(bigint, text)
  from public, anon, authenticated;
grant  execute on function api_limpiar_modulo(bigint, text)
  to   service_role;
