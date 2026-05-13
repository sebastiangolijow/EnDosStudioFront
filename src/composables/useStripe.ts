import { loadStripe } from '@stripe/stripe-js'
import type {
  Stripe,
  StripeElements,
  StripePaymentElement,
} from '@stripe/stripe-js'

/**
 * Singleton Stripe.js loader. Idempotent — calling `getStripe()` multiple
 * times across the app returns the same Promise; Stripe.js itself caches
 * the SDK in window after the first script-tag injection.
 *
 * The publishable key is baked at build time via Vite. If it's missing or
 * still the placeholder, getStripe() throws — caller is expected to surface
 * a "checkout misconfigured" toast.
 */

let stripePromise: Promise<Stripe | null> | null = null

export function getStripe(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  if (!key || key === 'pk_test_REPLACE_ME' || !key.startsWith('pk_')) {
    return Promise.reject(
      new Error('VITE_STRIPE_PUBLISHABLE_KEY no está configurada.'),
    )
  }
  stripePromise = loadStripe(key)
  return stripePromise
}

/**
 * Mount Stripe Elements + a <PaymentElement> into the given DOM node.
 * Returns the Elements + PaymentElement handles so the caller can call
 * stripe.confirmPayment with them, and unmount on cleanup.
 *
 * Locale defaults to 'es' — site is Spanish-only. Appearance is the
 * 'night' theme tweaked to match our orange/black palette so the card
 * form doesn't look like an alien stuck on the page.
 */
export interface MountedElements {
  stripe: Stripe
  elements: StripeElements
  paymentElement: StripePaymentElement
}

export async function mountPaymentElement(opts: {
  clientSecret: string
  node: HTMLElement
}): Promise<MountedElements> {
  const stripe = await getStripe()
  if (!stripe) {
    throw new Error('Stripe.js failed to load.')
  }
  const elements = stripe.elements({
    clientSecret: opts.clientSecret,
    locale: 'es',
    appearance: {
      theme: 'night',
      variables: {
        // Match tokens.css. Orange primary, warm text, surface darks.
        colorPrimary: '#FF3D0A',
        colorBackground: '#1B2027',
        colorText: '#F5F3EF',
        colorTextSecondary: '#AEB4BD',
        colorDanger: '#EF4444',
        borderRadius: '12px',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
    },
  })
  const paymentElement = elements.create('payment', {
    layout: 'tabs',
  })
  paymentElement.mount(opts.node)
  return { stripe, elements, paymentElement }
}
