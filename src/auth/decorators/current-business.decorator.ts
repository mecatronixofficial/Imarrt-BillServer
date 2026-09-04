import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentBusiness = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest();
  return request.businessId as string | undefined;
});
