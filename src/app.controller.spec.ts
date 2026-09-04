import { AppController } from './app.controller';

describe('AppController', () => {
  it('returns a healthy liveness response', () => {
    const response = new AppController({} as never, {} as never).getHealth();

    expect(response.status).toBe('ok');
    expect(response.service).toBe('billing-backend');
    expect(Number.isNaN(Date.parse(response.timestamp))).toBe(false);
  });
});
