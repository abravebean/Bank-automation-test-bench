# Requirements R14 and R15. Runs against the dashboard in CI with the scripted
# Codegen stand-in (playwright/fixtures/fake-codegen.js), so no bank is needed.
@R14 @mode:serial
Feature: Recording a test from the dashboard
  As a QA engineer
  I want to record a flow by clicking through it
  So that I get a clean test I can review instead of writing it by hand

  Background:
    Given I open the Recorder

  Scenario: Recording, reviewing and saving a test
    When I record a test named "bdd-invalid-login" starting at "https://demo-bank.example.com/login"
    Then each step appears as I click
    And the finished code reads the URL from ".env" instead of hard-coding it
    When I save the test
    Then the test is listed under saved recordings
    And I can delete it

  Scenario: Stopping a recording early keeps what was captured
    When I record a test named "bdd-stopped" starting at "https://demo-bank.example.com/login"
    And I stop the recording after the first step
    Then the recording finishes with fewer than 4 steps
    When I discard the recording
    Then I can start a new recording

  @R15
  Scenario Outline: An invalid test name is explained: "<name>"
    When I try to record a test named "<name>"
    Then I am told to use lowercase letters, numbers and dashes
    And no recording starts

    Examples:
      | name      |
      | My Test   |
      | ../../etc |
      | UPPERCASE |
      | -leading  |
