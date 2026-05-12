<script setup lang="ts">
/**
 * Admin users — single-purpose screen for the shop owner.
 *
 * Today the only writable field is `can_reserve_orders` (the whitelist
 * that gates the "Reservar y pagar en tienda" CTA at checkout). The
 * page reads as a list of customers with a per-row toggle; the row's
 * PATCH is optimistic + rolls back on error.
 *
 * Layout mirrors AdminProductsView: header + search/filter bar + table.
 */
import { computed, onMounted, ref, watch } from 'vue'
import DashboardShell from '@/components/layout/DashboardShell.vue'
import { usersService } from '@/services/users.service'
import { useToast } from '@/composables/useToast'
import type { User } from '@/types/auth'

const toast = useToast()

const users = ref<User[]>([])
const isLoading = ref<boolean>(false)
const totalCount = ref<number>(0)

// === Filter state ===
type ReserveFilter = 'all' | 'true' | 'false'
const searchInput = ref<string>('')
const debouncedSearch = ref<string>('')
const reserveFilter = ref<ReserveFilter>('all')
const pageSize = 50
const page = ref<number>(1)

const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / pageSize)))

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedSearch.value = v
    page.value = 1
  }, 500)
})

watch([debouncedSearch, reserveFilter], () => {
  page.value = 1
  load()
})

watch(page, () => load())

async function load() {
  isLoading.value = true
  try {
    const result = await usersService.adminList({
      search: debouncedSearch.value || undefined,
      can_reserve_orders:
        reserveFilter.value === 'all' ? undefined : reserveFilter.value === 'true',
      page: page.value,
      page_size: pageSize,
    })
    users.value = result.results
    totalCount.value = result.count
  } catch {
    toast.error('No pudimos cargar los usuarios.')
  } finally {
    isLoading.value = false
  }
}

/** Optimistic toggle — flip locally first, PATCH, roll back on error. */
async function toggleCanReserve(user: User) {
  const next = !user.can_reserve_orders
  const idx = users.value.findIndex((u) => u.uuid === user.uuid)
  if (idx < 0) return
  // Optimistic update
  users.value[idx] = { ...user, can_reserve_orders: next }
  try {
    const updated = await usersService.adminSetCanReserve(user.uuid, next)
    users.value[idx] = updated
    toast.success(
      next
        ? `Reserva habilitada para ${user.email}.`
        : `Reserva deshabilitada para ${user.email}.`,
    )
  } catch {
    users.value[idx] = user // rollback
    toast.error('No pudimos guardar el cambio.')
  }
}

function fullName(user: User): string {
  const trimmed = `${user.first_name} ${user.last_name}`.trim()
  return trimmed || '—'
}

onMounted(load)
</script>

<template>
  <DashboardShell>
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-h2 font-bold uppercase tracking-tight text-text">
          Usuarios
        </h1>
        <p class="mt-1 text-sm text-text-muted">
          Habilitá la reserva en tienda para los clientes que pagan en efectivo.
        </p>
      </div>
      <p class="text-sm text-text-muted">
        {{ totalCount }} usuario{{ totalCount === 1 ? '' : 's' }}
      </p>
    </header>

    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <input
        v-model="searchInput"
        type="search"
        placeholder="Buscar por nombre o email…"
        data-testid="admin-users-search"
        class="w-full max-w-sm rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:border-primary focus-visible:outline-none"
      >

      <div class="flex items-center gap-1 rounded-md border border-border bg-surface-2 p-1">
        <button
          v-for="opt in [
            { value: 'all', label: 'Todos' },
            { value: 'true', label: 'Con reserva' },
            { value: 'false', label: 'Sin reserva' },
          ] as const"
          :key="opt.value"
          type="button"
          :class="reserveFilter === opt.value
            ? 'rounded bg-primary px-3 py-1 text-xs font-semibold text-white'
            : 'rounded px-3 py-1 text-xs text-text-muted hover:text-text'"
          :data-testid="`admin-users-filter-${opt.value}`"
          @click="reserveFilter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Loading / empty / table -->
    <div
      v-if="isLoading && users.length === 0"
      class="rounded-md border border-border bg-surface-2 p-8 text-center text-text-muted"
    >
      Cargando…
    </div>

    <div
      v-else-if="users.length === 0"
      class="rounded-md border border-border bg-surface-2 p-8 text-center text-text-muted"
      data-testid="admin-users-empty"
    >
      Sin usuarios con esos filtros.
    </div>

    <div
      v-else
      class="overflow-x-auto rounded-md border border-border"
      data-testid="admin-users-list"
    >
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
          <tr>
            <th class="px-4 py-3">
              Nombre
            </th>
            <th class="px-4 py-3">
              Email
            </th>
            <th class="px-4 py-3">
              Rol
            </th>
            <th class="px-4 py-3">
              Puede reservar
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="user in users"
            :key="user.uuid"
            class="border-t border-border"
            :data-testid="`admin-user-row-${user.uuid}`"
          >
            <td class="px-4 py-3 text-text">
              {{ fullName(user) }}
            </td>
            <td class="break-all px-4 py-3 text-text">
              {{ user.email }}
            </td>
            <td class="px-4 py-3 text-text-muted">
              {{ user.role }}
            </td>
            <td class="px-4 py-3">
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  :checked="user.can_reserve_orders"
                  class="size-4 accent-primary"
                  :data-testid="`admin-user-toggle-${user.uuid}`"
                  @change="toggleCanReserve(user)"
                >
                <span class="text-xs text-text-muted">
                  {{ user.can_reserve_orders ? 'Sí' : 'No' }}
                </span>
              </label>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div
      v-if="totalPages > 1"
      class="mt-4 flex items-center justify-end gap-2 text-sm"
    >
      <button
        type="button"
        :disabled="page <= 1"
        class="rounded-md border border-border px-3 py-1 disabled:opacity-50"
        @click="page = Math.max(1, page - 1)"
      >
        ← Anterior
      </button>
      <span class="text-text-muted">
        Página {{ page }} / {{ totalPages }}
      </span>
      <button
        type="button"
        :disabled="page >= totalPages"
        class="rounded-md border border-border px-3 py-1 disabled:opacity-50"
        @click="page = Math.min(totalPages, page + 1)"
      >
        Siguiente →
      </button>
    </div>
  </DashboardShell>
</template>
