import { Country, Policy } from './types';

export const APP_LOGO = 'https://www.caremed-travelinsurance.com/images/default/caremed_logo.gif';
export const LOGO_LINK = 'https://www.work-and-travel-insurance.com/';

export const COUNTRIES: Country[] = [
  { code: 'MX', name: 'México', region: 2, language: 'Español', capital: 'Ciudad de México' },
  { code: 'US', name: 'Estados Unidos', region: 1, language: 'Inglés', capital: 'Washington D.C.' },
  { code: 'ES', name: 'España', region: 2, language: 'Español', capital: 'Madrid' },
  { code: 'AR', name: 'Argentina', region: 2, language: 'Español', capital: 'Buenos Aires' },
  { code: 'CO', name: 'Colombia', region: 2, language: 'Español', capital: 'Bogotá' },
  { code: 'CL', name: 'Chile', region: 2, language: 'Español', capital: 'Santiago' },
  { code: 'FR', name: 'Francia', region: 2, language: 'Francés', capital: 'París' },
  { code: 'DE', name: 'Alemania', region: 2, language: 'Alemán', capital: 'Berlín' },
  { code: 'GB', name: 'Reino Unido', region: 2, language: 'Inglés', capital: 'Londres' },
  { code: 'CA', name: 'Canadá', region: 1, language: 'Inglés/Francés', capital: 'Ottawa' },
  { code: 'BR', name: 'Brasil', region: 2, language: 'Portugués', capital: 'Brasilia' },
  { code: 'PE', name: 'Perú', region: 2, language: 'Español', capital: 'Lima' },
  { code: 'WW', name: 'World Wide (Mundial)', region: 1, language: 'Inglés', capital: 'N/A' },
];

export const INITIAL_POLICIES: Partial<Policy>[] = [
  // U6
  { plan: 'U6', name: 'Oro con deducible', deductible: true, region: 1, costPerDay: 5.97, pricePerDay: 12.50, pricePerMonth: 315.00, discountPercentage: 10 },
  { plan: 'U6', name: 'Oro con deducible', deductible: true, region: 2, costPerDay: 5.97, pricePerDay: 12.50, pricePerMonth: 315.00, discountPercentage: 10 },
  { plan: 'U6', name: 'Oro sin deducible', deductible: false, region: 1, costPerDay: 4.03, pricePerDay: 12.50, pricePerMonth: 315.00, discountPercentage: 10 },
  { plan: 'U6', name: 'Oro sin deducible', deductible: false, region: 2, costPerDay: 4.03, pricePerDay: 12.50, pricePerMonth: 315.00, discountPercentage: 10 },

  // Student - Region 1
  { plan: 'Student', name: 'Bronce con deducible', deductible: true, region: 1, costPerDay: 2.18, pricePerDay: 6.00, pricePerMonth: 145.00, discountPercentage: 20 },
  { plan: 'Student', name: 'Oro con deducible', deductible: true, region: 1, costPerDay: 2.70, pricePerDay: 8.50, pricePerMonth: 170.00, discountPercentage: 20 },
  { plan: 'Student', name: 'Oro sin deducible', deductible: false, region: 1, costPerDay: 3.13, pricePerDay: 18.00, pricePerMonth: 255.00, discountPercentage: 20 },
  { plan: 'Student', name: 'Plata con deducible', deductible: true, region: 1, costPerDay: 2.46, pricePerDay: 7.50, pricePerMonth: 160.00, discountPercentage: 20 },
  { plan: 'Student', name: 'Plata sin deducible', deductible: false, region: 1, costPerDay: 2.85, pricePerDay: 12.50, pricePerMonth: 180.00, discountPercentage: 20 },

  // Student - Region 2
  { plan: 'Student', name: 'Bronce con deducible', deductible: true, region: 2, costPerDay: 1.37, pricePerDay: 6.00, pricePerMonth: 145.00, discountPercentage: 20 },
  { plan: 'Student', name: 'Oro con deducible', deductible: true, region: 2, costPerDay: 1.82, pricePerDay: 8.50, pricePerMonth: 170.00, discountPercentage: 20 },
  { plan: 'Student', name: 'Oro sin deducible', deductible: false, region: 2, costPerDay: 2.05, pricePerDay: 18.00, pricePerMonth: 255.00, discountPercentage: 20 },
  { plan: 'Student', name: 'Plata con deducible', deductible: true, region: 2, costPerDay: 1.65, pricePerDay: 7.50, pricePerMonth: 160.00, discountPercentage: 20 },
  { plan: 'Student', name: 'Plata sin deducible', deductible: false, region: 2, costPerDay: 1.85, pricePerDay: 12.50, pricePerMonth: 180.00, discountPercentage: 20 },

  // Traveler - Region 1
  { plan: 'Traveler', name: 'Bronce con deducible', deductible: true, region: 1, costPerDay: 2.18, pricePerDay: 6.00, pricePerMonth: 145.00, discountPercentage: 20 },
  { plan: 'Traveler', name: 'Oro con deducible', deductible: true, region: 1, costPerDay: 3.25, pricePerDay: 8.50, pricePerMonth: 170.00, discountPercentage: 20 },
  { plan: 'Traveler', name: 'Oro sin deducible', deductible: false, region: 1, costPerDay: 3.35, pricePerDay: 18.00, pricePerMonth: 255.00, discountPercentage: 20 },
  { plan: 'Traveler', name: 'Plata con deducible', deductible: true, region: 1, costPerDay: 2.60, pricePerDay: 7.50, pricePerMonth: 160.00, discountPercentage: 20 },
  { plan: 'Traveler', name: 'Plata sin deducible', deductible: false, region: 1, costPerDay: 2.85, pricePerDay: 12.50, pricePerMonth: 180.00, discountPercentage: 20 },

  // Traveler - Region 2
  { plan: 'Traveler', name: 'Bronce con deducible', deductible: true, region: 2, costPerDay: 1.37, pricePerDay: 6.00, pricePerMonth: 145.00, discountPercentage: 20 },
  { plan: 'Traveler', name: 'Oro con deducible', deductible: true, region: 2, costPerDay: 2.05, pricePerDay: 8.50, pricePerMonth: 170.00, discountPercentage: 20 },
  { plan: 'Traveler', name: 'Oro sin deducible', deductible: false, region: 2, costPerDay: 2.15, pricePerDay: 18.00, pricePerMonth: 255.00, discountPercentage: 20 },
  { plan: 'Traveler', name: 'Plata con deducible', deductible: true, region: 2, costPerDay: 1.70, pricePerDay: 7.50, pricePerMonth: 160.00, discountPercentage: 20 },
  { plan: 'Traveler', name: 'Plata sin deducible', deductible: false, region: 2, costPerDay: 1.85, pricePerDay: 12.50, pricePerMonth: 180.00, discountPercentage: 20 },

  // O70 - Region 1 & 2
  { plan: 'O70', name: 'Plata con deducible', deductible: true, region: 1, costPerDay: 9.05, pricePerDay: 18.00, pricePerMonth: 460.00, discountPercentage: 0 },
  { plan: 'O70', name: 'Plata con deducible', deductible: true, region: 2, costPerDay: 5.95, pricePerDay: 18.00, pricePerMonth: 460.00, discountPercentage: 0 },

  // Platinum - Region 1 & 2
  { plan: 'Platinum', name: 'Platinum con deducible', deductible: true, region: 1, costPerDay: 2.67, pricePerDay: 8.50, pricePerMonth: 150.00, discountPercentage: 0 },
  { plan: 'Platinum', name: 'Platinum con deducible', deductible: true, region: 2, costPerDay: 1.85, pricePerDay: 8.50, pricePerMonth: 150.00, discountPercentage: 0 },

  // Xtreme - Region 1 & 2
  { plan: 'Xtreme', name: 'Oro sin deducible', deductible: false, region: 1, costPerDay: 3.41, pricePerDay: 18.00, pricePerMonth: 460.00, discountPercentage: 20 },
  { plan: 'Xtreme', name: 'Oro sin deducible', deductible: false, region: 2, costPerDay: 2.20, pricePerDay: 18.00, pricePerMonth: 460.00, discountPercentage: 20 },
];
