/**
 * The vault's note and image paths, shared by everything that shows markdown
 * outside the Notes frame (the task sheet): `[[` completion and image embeds.
 * Read once, refreshed when the vault changes on disk.
 */
import { useEffect, useState } from 'react';
import { vault, type VaultTree } from './backend';

let cached: VaultTree | null = null;
let loading: Promise<VaultTree | null> | null = null;
const subscribers = new Set<(t: VaultTree | null) => void>();

function refresh() {
  loading = vault
    .tree()
    .then((t) => {
      cached = t;
      subscribers.forEach((s) => s(t));
      return t;
    })
    .catch(() => null)
    .finally(() => {
      loading = null;
    });
  return loading;
}

let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  let soon: number | null = null;
  vault.onChanged(() => {
    if (soon !== null) return;
    soon = window.setTimeout(() => {
      soon = null;
      void refresh();
    }, 400);
  });
}

export function useVaultIndex(): VaultTree | null {
  const [tree, setTree] = useState<VaultTree | null>(cached);
  useEffect(() => {
    subscribers.add(setTree);
    watch();
    if (!cached && !loading) void refresh();
    return () => {
      subscribers.delete(setTree);
    };
  }, []);
  return tree;
}
