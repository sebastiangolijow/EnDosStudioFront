<script setup lang="ts">
import { computed } from 'vue'

interface Step {
  number: number
  label: string
}

interface Props {
  steps: Step[]
  current: number
}

const props = defineProps<Props>()

function stateOf(step: Step): 'done' | 'active' | 'pending' {
  if (step.number < props.current) return 'done'
  if (step.number === props.current) return 'active'
  return 'pending'
}

const stepNodes = computed(() =>
  props.steps.map((step) => ({
    ...step,
    state: stateOf(step),
  })),
)
</script>

<template>
  <ol
    class="flex items-center gap-3"
    aria-label="Progreso del pedido"
  >
    <template
      v-for="(step, idx) in stepNodes"
      :key="step.number"
    >
      <li class="flex items-center gap-2">
        <span
          :class="[
            'flex size-7 items-center justify-center rounded-full text-sm font-semibold',
            step.state === 'done' && 'bg-primary text-white',
            step.state === 'active' && 'border-2 border-primary text-primary shadow-orange',
            step.state === 'pending' && 'border border-border text-text-muted',
          ]"
          :aria-current="step.state === 'active' ? 'step' : undefined"
        >
          {{ step.number }}
        </span>
        <!-- Step labels are hidden < md to keep the stepper from
             overflowing on mobile (4 labels + 3 stretchy connectors
             don't fit in a 375 px viewport). The circled numbers +
             active/done coloring are enough signal; the page heading
             above already tells the customer which step they're on. -->
        <span
          :class="[
            'hidden text-sm md:inline',
            step.state === 'pending' ? 'text-text-muted' : 'text-text',
          ]"
        >
          {{ step.label }}
        </span>
        <!-- On mobile only, show the ACTIVE step's label inline so the
             customer has at least one piece of text confirming where
             they are. -->
        <span
          v-if="step.state === 'active'"
          class="text-sm text-text md:hidden"
        >
          {{ step.label }}
        </span>
      </li>
      <li
        v-if="idx < stepNodes.length - 1"
        class="h-px flex-1 bg-border"
        aria-hidden="true"
      />
    </template>
  </ol>
</template>
