import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{js,ts}'],
    environment: 'node',
    // O aparelho pode estar em qualquer fuso: os testes rodam longe de SP
    // para provar que nenhuma conta depende do fuso local.
    env: { TZ: 'Asia/Tokyo' },
  },
});
