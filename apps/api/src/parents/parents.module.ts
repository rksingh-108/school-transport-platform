import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { ParentsController } from './parents.controller';
import { ParentStudentLinksController } from './parent-student-links.controller';
import { ParentSelfController } from './parent-self.controller';
import { ParentsService } from './parents.service';
import { ParentSelfService } from './parent-self.service';

@Module({
  imports: [InvitationsModule],
  controllers: [ParentsController, ParentStudentLinksController, ParentSelfController],
  providers: [ParentsService, ParentSelfService],
})
export class ParentsModule {}
