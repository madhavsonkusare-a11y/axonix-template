/**
 * Brand marks for the institutions, payment apps and ID issuers the tracker
 * knows about.
 *
 * Every mark is shipped in `assets/brands/` rather than hot-linked: the
 * "Local" invariant rules out a network fetch for an icon. Sources, so they can
 * be refreshed:
 *   - app icons (128px): the official Google Play / App Store listing for each
 *     app — they are what the owner sees on their phone, so they read fastest
 *   - `sbi`, `upi`, `rupay`: Wikimedia Commons SVGs
 *   - `visa`: Simple Icons (CC0)
 *   - `mastercard`, `jar`: the owner's brand-kit files (Jar's wordmark removed;
 *     the mark keeps Jar's dark ground so its white outline stays visible)
 *   - `epfo`: the seal embedded in the official logo on epfo.gov.in
 *     (`epfo-logo-svg.svg`), wordmark dropped, resized to 128px
 *
 * `links` are official sites, opened in the system browser from the details
 * sheets. Each was checked to load when added (2026-09-13).
 *
 * `fit: 'cover'` marks are full-bleed app icons; `contain` marks are logos
 * that need a white tile and some padding to sit at the same optical size.
 */
import type { BrandId } from './types';

import sbi from '../assets/brands/sbi.svg';
import icici from '../assets/brands/icici.png';
import groww from '../assets/brands/groww.png';
import thomascook from '../assets/brands/thomascook.png';
import jar from '../assets/brands/jar.svg';
import epfo from '../assets/brands/epfo.png';
import gpay from '../assets/brands/gpay.png';
import whatsapp from '../assets/brands/whatsapp.png';
import pop from '../assets/brands/pop.png';
import paypal from '../assets/brands/paypal.png';
import link from '../assets/brands/link.png';
import upi from '../assets/brands/upi.svg';
import visa from '../assets/brands/visa.svg';
import mastercard from '../assets/brands/mastercard.svg';
import rupay from '../assets/brands/rupay.svg';
import digilocker from '../assets/brands/digilocker.png';
import aadhaar from '../assets/brands/aadhaar.png';
import incometax from '../assets/brands/incometax.png';
import parivahan from '../assets/brands/parivahan.png';
import passport from '../assets/brands/passport.png';
import voter from '../assets/brands/voter.png';
import abha from '../assets/brands/abha.png';
import umang from '../assets/brands/umang.png';

export interface BrandLink {
  label: string;
  url: string;
}

export interface Brand {
  name: string;
  src: string;
  fit: 'cover' | 'contain';
  /** Words the quick-entry parser accepts for this brand. */
  aliases: string[];
  links?: BrandLink[];
}

const ICICI_LOGIN =
  'https://infinity.icicibank.com/corp/AuthenticationController?FORMSGROUP_ID__=AuthenticationFG&__START_TRAN_FLAG__=Y&FG_BUTTONS__=LOAD&ACTION.LOAD=Y&AuthenticationFG.LOGIN_FLAG=1&BANK_ID=ICI';

export const BRANDS: Record<BrandId, Brand> = {
  sbi: {
    name: 'SBI', src: sbi, fit: 'contain', aliases: ['sbi', 'state bank', 'yono'],
    links: [{ label: 'SBI Online banking', url: 'https://www.onlinesbi.sbi/' }, { label: 'State Bank of India', url: 'https://sbi.co.in/' }],
  },
  icici: {
    name: 'ICICI Bank', src: icici, fit: 'cover', aliases: ['icici', 'imobile'],
    links: [{ label: 'ICICI net banking', url: ICICI_LOGIN }, { label: 'ICICI Bank', url: 'https://www.icicibank.com/' }],
  },
  epfo: {
    name: 'EPF · EPFO', src: epfo, fit: 'contain', aliases: ['epf', 'epfo'],
    links: [
      { label: 'EPFO member portal (UAN)', url: 'https://unifiedportal-mem.epfindia.gov.in/memberinterface/' },
      { label: 'EPF passbook', url: 'https://passbook.epfindia.gov.in/MemberPassBook/login' },
      { label: 'EPFO', url: 'https://www.epfo.gov.in/' },
    ],
  },
  groww: {
    name: 'Groww', src: groww, fit: 'cover', aliases: ['groww', 'demat'],
    links: [{ label: 'Groww', url: 'https://groww.in/' }],
  },
  thomascook: {
    name: 'Thomas Cook', src: thomascook, fit: 'cover', aliases: ['thomas cook', 'thomascook', 'forex', 'tc'],
    links: [
      { label: 'Borderless forex card', url: 'https://www.thomascook.in/foreign-exchange/borderless-prepaid-multicurrency-card' },
      { label: 'Thomas Cook forex', url: 'https://www.thomascook.in/foreign-exchange' },
    ],
  },
  jar: {
    name: 'Jar', src: jar, fit: 'cover', aliases: ['jar'],
    links: [{ label: 'Jar', url: 'https://www.myjar.app/' }],
  },
  gpay: {
    name: 'Google Pay', src: gpay, fit: 'cover', aliases: ['gpay', 'google pay', 'googlepay', 'gp'],
    links: [{ label: 'Google Pay', url: 'https://pay.google.com/intl/en_in/about/' }],
  },
  whatsapp: {
    name: 'WhatsApp Pay', src: whatsapp, fit: 'cover', aliases: ['whatsapp', 'whatsapp pay', 'wa', 'wapay'],
    links: [{ label: 'WhatsApp Pay', url: 'https://www.whatsapp.com/payments/in' }],
  },
  pop: {
    name: 'POP UPI', src: pop, fit: 'cover', aliases: ['pop', 'pop upi', 'popupi', 'popclub'],
    links: [{ label: 'POP', url: 'https://popclub.co/' }],
  },
  paypal: {
    name: 'PayPal', src: paypal, fit: 'cover', aliases: ['paypal', 'pp'],
    links: [{ label: 'PayPal', url: 'https://www.paypal.com/in/signin' }],
  },
  link: {
    name: 'Link', src: link, fit: 'cover', aliases: ['link', 'stripe link'],
    links: [{ label: 'Link', url: 'https://link.com/' }],
  },
  upi: { name: 'UPI', src: upi, fit: 'contain', aliases: ['upi'] },
  visa: { name: 'Visa', src: visa, fit: 'contain', aliases: ['visa'] },
  mastercard: { name: 'Mastercard', src: mastercard, fit: 'contain', aliases: ['mastercard'] },
  rupay: { name: 'RuPay', src: rupay, fit: 'contain', aliases: ['rupay'] },
  digilocker: {
    name: 'DigiLocker', src: digilocker, fit: 'cover', aliases: ['digilocker'],
    links: [{ label: 'DigiLocker', url: 'https://www.digilocker.gov.in/' }],
  },
  aadhaar: {
    name: 'Aadhaar', src: aadhaar, fit: 'cover', aliases: ['aadhaar'],
    links: [{ label: 'myAadhaar', url: 'https://myaadhaar.uidai.gov.in/' }],
  },
  incometax: {
    name: 'Income Tax', src: incometax, fit: 'cover', aliases: ['pan'],
    links: [{ label: 'Income Tax e-Filing', url: 'https://www.incometax.gov.in/iec/foportal/' }],
  },
  parivahan: {
    name: 'Parivahan', src: parivahan, fit: 'cover', aliases: ['dl', 'licence'],
    links: [{ label: 'Sarathi · Parivahan', url: 'https://sarathi.parivahan.gov.in/' }],
  },
  passport: {
    name: 'Passport Seva', src: passport, fit: 'cover', aliases: ['passport'],
    links: [{ label: 'Passport Seva', url: 'https://www.passportindia.gov.in/' }],
  },
  voter: {
    name: 'Voter Helpline', src: voter, fit: 'cover', aliases: ['voter'],
    links: [{ label: "Voters' Service Portal", url: 'https://voters.eci.gov.in/' }],
  },
  abha: {
    name: 'ABHA', src: abha, fit: 'cover', aliases: ['abha'],
    links: [{ label: 'ABHA', url: 'https://abha.abdm.gov.in/' }],
  },
  umang: {
    name: 'UMANG · EPFO', src: umang, fit: 'cover', aliases: ['uan', 'epfo'],
    links: [{ label: 'EPFO member portal', url: 'https://unifiedportal-mem.epfindia.gov.in/memberinterface/' }],
  },
};

/** Brands offered when adding an account or payment method. */
export const ACCOUNT_BRANDS: BrandId[] = ['sbi', 'icici', 'epfo', 'groww', 'thomascook', 'jar', 'paypal', 'link'];
export const METHOD_BRANDS: BrandId[] = ['gpay', 'whatsapp', 'pop', 'upi', 'sbi', 'icici', 'thomascook', 'paypal', 'link'];
