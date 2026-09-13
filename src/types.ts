export type Role = 'USER' | 'ADMIN';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type AppBindings = {
  Bindings: Env;
  Variables: { user: AuthUser };
};
