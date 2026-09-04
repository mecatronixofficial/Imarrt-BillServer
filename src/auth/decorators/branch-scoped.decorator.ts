import { SetMetadata } from '@nestjs/common';

export const BRANCH_SCOPED_KEY = 'branch-scoped';
export const BranchScoped = () => SetMetadata(BRANCH_SCOPED_KEY, true);
