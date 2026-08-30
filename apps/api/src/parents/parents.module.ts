import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { AuthModule } from '../auth/auth.module';
import { GpsModule } from '../gps/gps.module';
import { ParentsController } from './parents.controller';
import { ParentStudentLinksController } from './parent-student-links.controller';
import { ParentSelfController } from './parent-self.controller';
import { ParentTransportController } from './parent-transport.controller';
import { ParentsService } from './parents.service';
import { ParentSelfService } from './parent-self.service';
import { ParentTransportService } from './parent-transport.service';
import { ParentGateway } from './parent.gateway';

@Module({
  // AuthModule: TokenService/AuthService/ParentAccessService for
  // ParentGateway's handshake auth + verified-children resolution.
  // GpsModule: GpsService (current-location reads) + GpsGateway
  // (location-update hook) for ParentTransportService/ParentGateway.
  imports: [InvitationsModule, AuthModule, GpsModule],
  controllers: [ParentsController, ParentStudentLinksController, ParentSelfController, ParentTransportController],
  providers: [ParentsService, ParentSelfService, ParentTransportService, ParentGateway],
})
export class ParentsModule {}
