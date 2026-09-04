import { SetMetadata } from '@nestjs/common';

export const BUSINESS_SCOPED_KEY = 'business-scoped';
export const BusinessScoped = () => SetMetadata(BUSINESS_SCOPED_KEY, true);
