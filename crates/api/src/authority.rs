//! Commit-bound authorization for session-derived HTTP work.
//!
//! Request extractors reject obviously invalid credentials early, but their
//! result is only a hint after password hashing, provider calls, or lock waits.
//! `AuthorizedUnitOfWork` revalidates the exact initiating session inside the
//! transaction that owns the durable mutation and keeps that transaction
//! private until the caller explicitly commits it.

use super::auth_http::{
    require_global_admin_context, unauthorized_session, AuthHttpState, AuthenticatedRequest,
};
use crate::ApiError;
use identity::AuthorizationContext;
use principal::PrincipalId;
use sqlx::{Postgres, Transaction};

pub(super) struct AuthorizedUnitOfWork {
    transaction: Transaction<'static, Postgres>,
    authorization: AuthorizationContext,
}

impl AuthorizedUnitOfWork {
    /// Start after all untrusted/expensive preparation is complete. The
    /// canonical identity owner and all of its sessions are locked by the
    /// identity validator before this returns.
    pub(super) async fn begin(
        state: &AuthHttpState,
        request: &AuthenticatedRequest,
    ) -> Result<Self, ApiError> {
        let mut transaction = identity::session::begin_authority_transaction(&state.pool).await?;
        let authorization = identity::session::validate_session_for_update(
            &mut transaction,
            request.bearer.as_str(),
            &state.session_policy,
        )
        .await?;
        if authorization.principal_id != request.context.principal_id {
            return Err(unauthorized_session());
        }
        Ok(Self {
            transaction,
            authorization,
        })
    }

    pub(super) fn principal_id(&self) -> PrincipalId {
        self.authorization.principal_id
    }

    pub(super) fn require_global_admin(&self, action: &str) -> Result<PrincipalId, ApiError> {
        require_global_admin_context(&self.authorization, action)
    }

    pub(super) fn transaction(&mut self) -> &mut Transaction<'static, Postgres> {
        &mut self.transaction
    }

    pub(super) async fn commit(self) -> Result<(), ApiError> {
        self.transaction.commit().await?;
        Ok(())
    }
}
