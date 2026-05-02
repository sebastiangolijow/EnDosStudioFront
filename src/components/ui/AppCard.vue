<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  /** Adds a subtle orange glow border. Use for selected MaterialCard, hero feature cards. */
  glow?: boolean
  /** Sets a holographic gradient backdrop for accent moments. Use sparingly. */
  holographic?: boolean
  /** Less padding for compact dashboards. */
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  glow: false,
  holographic: false,
  compact: false,
})

const classes = computed(() =>
  [
    'rounded-lg border bg-surface-1 shadow-card',
    props.compact ? 'p-4' : 'p-5',
    props.glow ? 'border-primary shadow-orange' : 'border-border',
    props.holographic ? 'bg-holographic' : '',
  ].join(' '),
)
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>
