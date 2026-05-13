<script setup lang="ts">
/**
 * Admin discounts — staff manages promo codes.
 *
 * One table + a small modal for create / edit. Codes are normalized to
 * uppercase by the backend so the form accepts free-form input. Disabling
 * (vs deleting) preserves audit trail on past orders that used the code.
 */
import { onMounted, ref } from 'vue'
import DashboardShell from '@/components/layout/DashboardShell.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { useToast } from '@/composables/useToast'
import {
  type Discount,
  discountsService,
} from '@/services/discounts.service'

const toast = useToast()

const discounts = ref<Discount[]>([])
const isLoading = ref<boolean>(false)

// Modal state. When editingUuid is null we're creating; otherwise editing.
const isModalOpen = ref<boolean>(false)
const editingUuid = ref<string | null>(null)
const formCode = ref<string>('')
const formPercent = ref<string>('10')
const formEnabled = ref<boolean>(true)
const isSaving = ref<boolean>(false)

async function load() {
  isLoading.value = true
  try {
    const page = await discountsService.list()
    discounts.value = page.results
  } catch {
    toast.error('No pudimos cargar los descuentos.')
  } finally {
    isLoading.value = false
  }
}

function openCreate() {
  editingUuid.value = null
  formCode.value = ''
  formPercent.value = '10'
  formEnabled.value = true
  isModalOpen.value = true
}

function openEdit(d: Discount) {
  editingUuid.value = d.uuid
  formCode.value = d.code
  formPercent.value = String(d.percent_off)
  formEnabled.value = d.is_enabled
  isModalOpen.value = true
}

async function submitForm() {
  const code = formCode.value.trim().toUpperCase()
  if (!code) {
    toast.warning('Ingresá un código.')
    return
  }
  const percent = Number.parseInt(formPercent.value, 10)
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    toast.warning('El porcentaje debe estar entre 1 y 100.')
    return
  }
  isSaving.value = true
  try {
    if (editingUuid.value) {
      const updated = await discountsService.update(editingUuid.value, {
        code,
        percent_off: percent,
        is_enabled: formEnabled.value,
      })
      const idx = discounts.value.findIndex((d) => d.uuid === updated.uuid)
      if (idx >= 0) discounts.value[idx] = updated
      toast.success(`Descuento ${updated.code} actualizado.`)
    } else {
      const created = await discountsService.create({
        code,
        percent_off: percent,
        is_enabled: formEnabled.value,
      })
      discounts.value = [created, ...discounts.value]
      toast.success(`Descuento ${created.code} creado.`)
    }
    isModalOpen.value = false
  } catch (e) {
    const detail
      = (e as { response?: { data?: Record<string, unknown> } }).response?.data
    if (
      detail && typeof detail === 'object' && 'code' in detail
      && Array.isArray((detail as { code: unknown[] }).code)
    ) {
      toast.error('Ya existe un descuento con ese código.')
    } else {
      toast.error('No pudimos guardar el descuento.')
    }
  } finally {
    isSaving.value = false
  }
}

async function toggleEnabled(d: Discount) {
  const next = !d.is_enabled
  const idx = discounts.value.findIndex((row) => row.uuid === d.uuid)
  if (idx < 0) return
  // Optimistic
  discounts.value[idx] = { ...d, is_enabled: next }
  try {
    const updated = await discountsService.update(d.uuid, { is_enabled: next })
    discounts.value[idx] = updated
  } catch {
    discounts.value[idx] = d // rollback
    toast.error('No pudimos cambiar el estado.')
  }
}

async function removeDiscount(d: Discount) {
  if (!confirm(`¿Eliminar el código ${d.code}? Esta acción no se puede deshacer.`)) {
    return
  }
  try {
    await discountsService.remove(d.uuid)
    discounts.value = discounts.value.filter((row) => row.uuid !== d.uuid)
    toast.success(`Código ${d.code} eliminado.`)
  } catch {
    toast.error('No pudimos eliminar el código.')
  }
}

onMounted(load)
</script>

<template>
  <DashboardShell>
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-h2 font-bold uppercase tracking-tight text-text">
          Descuentos
        </h1>
        <p class="mt-1 text-sm text-text-muted">
          Creá códigos promocionales que los clientes pueden aplicar al pagar.
        </p>
      </div>
      <AppButton
        data-testid="admin-discounts-new"
        @click="openCreate"
      >
        + Nuevo código
      </AppButton>
    </header>

    <div
      v-if="isLoading && discounts.length === 0"
      class="rounded-md border border-border bg-surface-2 p-8 text-center text-text-muted"
    >
      Cargando…
    </div>

    <div
      v-else-if="discounts.length === 0"
      class="rounded-md border border-border bg-surface-2 p-8 text-center text-text-muted"
      data-testid="admin-discounts-empty"
    >
      Aún no hay descuentos. Tocá <strong class="text-text">+ Nuevo código</strong> para empezar.
    </div>

    <div
      v-else
      class="overflow-x-auto rounded-md border border-border"
      data-testid="admin-discounts-list"
    >
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
          <tr>
            <th class="px-4 py-3">
              Código
            </th>
            <th class="px-4 py-3">
              % Descuento
            </th>
            <th class="px-4 py-3">
              Activo
            </th>
            <th class="px-4 py-3">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in discounts"
            :key="d.uuid"
            class="border-t border-border"
            :data-testid="`admin-discount-row-${d.uuid}`"
          >
            <td class="break-all px-4 py-3 font-mono text-text">
              {{ d.code }}
            </td>
            <td class="px-4 py-3 text-text">
              {{ d.percent_off }}%
            </td>
            <td class="px-4 py-3">
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  :checked="d.is_enabled"
                  class="size-4 accent-primary"
                  :data-testid="`admin-discount-toggle-${d.uuid}`"
                  @change="toggleEnabled(d)"
                >
                <span class="text-xs text-text-muted">
                  {{ d.is_enabled ? 'Sí' : 'No' }}
                </span>
              </label>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-2 text-xs">
                <button
                  class="text-primary hover:underline"
                  :data-testid="`admin-discount-edit-${d.uuid}`"
                  @click="openEdit(d)"
                >
                  Editar
                </button>
                <span class="text-border">·</span>
                <button
                  class="text-error hover:underline"
                  :data-testid="`admin-discount-delete-${d.uuid}`"
                  @click="removeDiscount(d)"
                >
                  Eliminar
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create / edit modal -->
    <AppModal
      :open="isModalOpen"
      :title="editingUuid ? 'Editar descuento' : 'Nuevo descuento'"
      size="md"
      @close="isModalOpen = false"
    >
      <div class="flex flex-col gap-4">
        <AppInput
          v-model="formCode"
          label="Código"
          placeholder="WELCOME10"
          required
          data-testid="admin-discount-form-code"
          helper="Se normaliza a mayúsculas al guardar."
        />
        <AppInput
          v-model="formPercent"
          label="Porcentaje de descuento (1-100)"
          type="number"
          required
          data-testid="admin-discount-form-percent"
        />
        <label class="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-4 py-3">
          <input
            v-model="formEnabled"
            type="checkbox"
            class="size-4 accent-primary"
            data-testid="admin-discount-form-enabled"
          >
          <div class="flex-1">
            <p class="text-sm font-semibold text-text">
              Habilitado
            </p>
            <p class="text-xs text-text-muted">
              Destildá para esconder el código sin borrarlo (los pedidos
              que ya lo usaron siguen funcionando).
            </p>
          </div>
        </label>
      </div>

      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <AppButton
            variant="ghost"
            :disabled="isSaving"
            @click="isModalOpen = false"
          >
            Cancelar
          </AppButton>
          <AppButton
            :loading="isSaving"
            data-testid="admin-discount-form-submit"
            @click="submitForm"
          >
            {{ editingUuid ? 'Guardar' : 'Crear' }}
          </AppButton>
        </div>
      </template>
    </AppModal>
  </DashboardShell>
</template>
