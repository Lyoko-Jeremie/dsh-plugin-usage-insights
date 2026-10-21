/** Billing bands of the DeepSeek price list. */
export type BillingBand = 'peak' | 'off-peak'

/** Both bands, in ascending price order. */
export declare const BILLING_BANDS: readonly BillingBand[]

/**
 * Beijing calendar day of a timestamp.
 * @param atMs - Unix epoch milliseconds.
 * @returns `YYYY-MM-DD` in Beijing time.
 */
export declare function beijingDay(atMs: number): string

/**
 * Billing band of one request start.
 * @param atMs - Unix epoch milliseconds of the request start.
 * @param holidays - Beijing `YYYY-MM-DD` holiday keys.
 * @returns the band the request is billed in.
 */
export declare function bandAt(atMs: number, holidays?: readonly string[]): BillingBand
