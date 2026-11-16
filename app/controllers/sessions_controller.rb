# Placeholder sign-in for development: stands in for a real OAuth provider so
# the consented self-portrait flow can be built and tried. It proves nothing;
# it only sets a transient session identity. Disabled in production.
class SessionsController < ApplicationController
  before_action :ensure_enabled

  def create
    name = params[:name].to_s.strip.first(60)
    session[:identity] = { "name" => name.presence || "You", "signed_in_at" => Time.current.iso8601 }
    redirect_to self_portrait_path
  end

  def destroy
    reset_session
    redirect_to self_portrait_path
  end

  private

  def ensure_enabled
    head :forbidden unless Rails.configuration.x.dummy_sign_in
  end
end
