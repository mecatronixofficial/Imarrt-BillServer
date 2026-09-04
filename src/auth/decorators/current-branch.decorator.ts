import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentBranch = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest();
  return request.branchId as string | undefined;
});
